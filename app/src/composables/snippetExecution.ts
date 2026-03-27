import type { ComputedRef, Ref } from 'vue'
import { snippetCommandLines } from './snippetHelpers'
import type { SnippetItem, TerminalMode } from './snippetTypes'

type CreateSnippetExecutionParams = {
  hostItems: Ref<any[]>
  sshForm: Ref<{ host: string; port: number; username: string }>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  activeTerminalMode: Ref<TerminalMode>
  serialConnected: Ref<boolean>
  serialCurrentPath: Ref<string>
  localConnected: Readonly<Ref<boolean>>
  activeLocalSessionId: Readonly<Ref<string>>
  recordLocalInput: (sessionId: string, data: string) => void
  useHost: (host: any) => void
  connectSSH: (options?: { keepNav?: boolean } | Event) => Promise<boolean>
  focusTerminal: () => void
  snippetItems: Ref<SnippetItem[]>
  snippetEdit: Ref<SnippetItem>
  selectedSnippetId: Ref<string>
  terminalSnippetId: Ref<string>
  terminalSnippetItems: ComputedRef<SnippetItem[]>
  snippetStatus: Ref<string>
  snippetRunDelayMs: Ref<number>
  snippetRunning: Ref<boolean>
  snippetStopRequested: Ref<boolean>
  saveSnippetState: () => Promise<boolean>
}

export function createSnippetExecution(params: CreateSnippetExecutionParams) {
  const {
    hostItems,
    sshForm,
    sshConnected,
    sshSessionId,
    activeTerminalMode,
    serialConnected,
    serialCurrentPath,
    localConnected,
    activeLocalSessionId,
    recordLocalInput,
    useHost,
    connectSSH,
    focusTerminal,
    snippetItems,
    snippetEdit,
    selectedSnippetId,
    terminalSnippetId,
    terminalSnippetItems,
    snippetStatus,
    snippetRunDelayMs,
    snippetRunning,
    snippetStopRequested,
    saveSnippetState,
  } = params

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const updateSnippetResult = async (
    snippetId: string,
    patch: Partial<Pick<SnippetItem, 'lastRunAt' | 'lastRunStatus' | 'lastRunOutput' | 'updatedAt'>>,
  ) => {
    if (!snippetId) return
    const nextUpdatedAt = Number(patch.updatedAt || Date.now())
    snippetItems.value = snippetItems.value.map((item) => (
      item.id === snippetId
        ? {
            ...item,
            ...patch,
            updatedAt: nextUpdatedAt,
          }
        : item
    ))
    if (snippetEdit.value.id === snippetId) {
      snippetEdit.value = {
        ...snippetEdit.value,
        ...patch,
        updatedAt: nextUpdatedAt,
      }
    }
    await saveSnippetState()
  }

  const buildSnippetExecConfig = async (target: SnippetItem) => {
    const host = hostItems.value.find((item) => item.id === target.hostId)
    if (!host) throw new Error('未找到绑定的目标服务器')
    let privateKey = ''
    if ((host.auth_type || host.authType) === 'key') {
      const keyRef = String(host.private_key_ref || host.privateKeyRef || '').trim()
      if (!keyRef) throw new Error('目标服务器缺少可用密钥')
      const keyRes = await window.lightterm.vaultKeyGet({ id: keyRef })
      if (!keyRes.ok || !keyRes.item?.privateKey) {
        throw new Error(keyRes.error || '读取服务器密钥失败')
      }
      privateKey = String(keyRes.item.privateKey || '')
    }
    return {
      host: String(host.host || ''),
      port: Number(host.port || 22),
      username: String(host.username || ''),
      password: (host.auth_type || host.authType) === 'key' ? undefined : (String(host.password || '') || undefined),
      privateKey: privateKey || undefined,
    }
  }

  const executeSnippetTask = async (target: SnippetItem) => {
    if (!target?.id) {
      snippetStatus.value = '请先选择一个代码片段'
      return false
    }
    if (!target.hostId) {
      const message = '请先给代码片段绑定目标服务器'
      snippetStatus.value = message
      await updateSnippetResult(target.id, {
        lastRunAt: Date.now(),
        lastRunStatus: 'error',
        lastRunOutput: message,
      })
      return false
    }
    const script = String(target.commands || '').trim()
    if (!script) {
      snippetStatus.value = '片段内容为空'
      return false
    }
    const currentItem = snippetItems.value.find((item) => item.id === target.id)
    if (currentItem?.lastRunStatus === 'running') return false

    await updateSnippetResult(target.id, {
      lastRunAt: Date.now(),
      lastRunStatus: 'running',
      lastRunOutput: '正在执行片段...',
    })
    try {
      const config = await buildSnippetExecConfig(target)
      const res = await window.lightterm.sshExecScript({
        ...config,
        script,
        timeoutMs: 180000,
      })
      const stdout = String(res.stdout || '').trim()
      const stderr = String(res.stderr || '').trim()
      const mergedOutput = [stdout, stderr].filter(Boolean).join('\n\n').trim()
      const finalOutput = mergedOutput || (res.ok ? '执行完成，无输出' : (res.error || '执行失败'))
      await updateSnippetResult(target.id, {
        lastRunAt: Date.now(),
        lastRunStatus: res.ok ? 'success' : 'error',
        lastRunOutput: finalOutput.slice(0, 8000),
      })
      snippetStatus.value = res.ok
        ? `执行完成：${target.name}`
        : `执行失败：${target.name}${res.error ? ` ｜ ${res.error}` : ''}`
      return !!res.ok
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行失败'
      await updateSnippetResult(target.id, {
        lastRunAt: Date.now(),
        lastRunStatus: 'error',
        lastRunOutput: message,
      })
      snippetStatus.value = `执行失败：${message}`
      return false
    }
  }

  const sendCommandsToLocalTerminal = async (target: SnippetItem, lines: string[]) => {
    if (!localConnected.value || !activeLocalSessionId.value) {
      snippetStatus.value = '请先连接本地终端'
      return
    }
    snippetRunning.value = true
    snippetStopRequested.value = false
    const delayMs = Math.max(120, Number(snippetRunDelayMs.value || 0))
    let sent = 0
    for (let i = 0; i < lines.length; i += 1) {
      if (snippetStopRequested.value) break
      const cmd = lines[i]
      const res = await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: `${cmd}\n` })
      if (!res.ok) {
        snippetStatus.value = `本地执行失败：${res.error || '未知错误'}`
        break
      }
      recordLocalInput(activeLocalSessionId.value, `${cmd}\n`)
      sent += 1
      if (i < lines.length - 1) await sleep(delayMs)
    }
    snippetRunning.value = false
    snippetStopRequested.value = false
    snippetStatus.value = sent === lines.length
      ? `本地执行完成：${target.name}`
      : `本地已执行 ${sent}/${lines.length}`
    focusTerminal()
  }

  const ensureSnippetSession = async (target: SnippetItem) => {
    if (target.hostId) {
      const host = hostItems.value.find((item) => item.id === target.hostId)
      if (!host) {
        snippetStatus.value = '片段绑定的主机不存在，请重新选择'
        return false
      }
      const sameHost = sshConnected.value
        && sshForm.value.host === host.host
        && Number(sshForm.value.port || 22) === Number(host.port || 22)
        && sshForm.value.username === host.username
      if (!sameHost) {
        useHost(host)
        await connectSSH({ keepNav: true })
        if (!sshConnected.value) {
          snippetStatus.value = '目标主机连接失败，已停止执行'
          return false
        }
      }
    } else if (!sshConnected.value) {
      snippetStatus.value = '请先连接 SSH，或在片段里绑定目标主机'
      return false
    }
    return true
  }

  const runSnippet = async (item?: SnippetItem) => {
    const target = item
      || snippetItems.value.find((entry) => entry.id === selectedSnippetId.value)
      || snippetEdit.value
    await executeSnippetTask(target)
  }

  const stopSnippet = () => {
    if (!snippetRunning.value) return
    snippetStopRequested.value = true
  }

  const getTerminalSnippet = () => {
    if (terminalSnippetId.value) {
      const matched = terminalSnippetItems.value.find((item) => item.id === terminalSnippetId.value)
      if (matched) return matched
    }
    if (selectedSnippetId.value) {
      const selected = terminalSnippetItems.value.find((item) => item.id === selectedSnippetId.value)
      if (selected) return selected
    }
    return terminalSnippetItems.value[0] || null
  }

  const runTerminalSnippet = async () => {
    const target = getTerminalSnippet()
    if (!target) {
      snippetStatus.value = '没有可执行的代码片段'
      return
    }

    if (activeTerminalMode.value === 'ssh') {
      await runSnippet(target)
      focusTerminal()
      return
    }

    const lines = snippetCommandLines(target.commands || '')
    if (lines.length === 0) {
      snippetStatus.value = '没有可执行命令（空行和 # 注释会自动跳过）'
      return
    }

    if (activeTerminalMode.value === 'serial') {
      if (!serialConnected.value || !serialCurrentPath.value) {
        snippetStatus.value = '请先连接串口'
        return
      }
      snippetRunning.value = true
      snippetStopRequested.value = false
      let sent = 0
      const delayMs = Math.max(100, Number(snippetRunDelayMs.value || 0))
      for (let i = 0; i < lines.length; i += 1) {
        if (snippetStopRequested.value) break
        const cmd = lines[i]
        const res = await window.lightterm.sendSerial({
          path: serialCurrentPath.value,
          data: `${cmd}\r\n`,
          isHex: false,
        })
        if (!res.ok) {
          snippetStatus.value = `串口发送失败：${res.error || '未知错误'}`
          break
        }
        sent += 1
        if (i < lines.length - 1) await sleep(delayMs)
      }
      snippetRunning.value = false
      snippetStopRequested.value = false
      snippetStatus.value = sent === lines.length
        ? `串口发送完成：${target.name}`
        : `串口已发送 ${sent}/${lines.length}`
      focusTerminal()
      return
    }

    await sendCommandsToLocalTerminal(target, lines)
  }

  const executeSnippetOnLocalTerminal = async (target: SnippetItem) => {
    if (!target?.id) {
      snippetStatus.value = '没有可执行的代码片段'
      return
    }
    const lines = snippetCommandLines(target.commands || '')
    if (lines.length === 0) {
      snippetStatus.value = '没有可执行命令（空行和 # 注释会自动跳过）'
      return
    }
    await sendCommandsToLocalTerminal(target, lines)
  }

  const sendSnippetRawToTerminal = async () => {
    const target = getTerminalSnippet()
    if (!target) {
      snippetStatus.value = '没有可发送的代码片段'
      return
    }
    const payload = target.commands || ''
    if (!payload.trim()) {
      snippetStatus.value = '片段内容为空'
      return
    }

    if (activeTerminalMode.value === 'ssh') {
      const ready = await ensureSnippetSession(target)
      if (!ready) return
    } else if (activeTerminalMode.value === 'serial' && (!serialConnected.value || !serialCurrentPath.value)) {
      snippetStatus.value = '请先连接串口'
      return
    } else if (activeTerminalMode.value === 'local' && (!localConnected.value || !activeLocalSessionId.value)) {
      snippetStatus.value = '请先连接本地终端'
      return
    }

    const res = activeTerminalMode.value === 'ssh'
      ? await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: payload })
      : activeTerminalMode.value === 'serial'
        ? await window.lightterm.sendSerial({ path: serialCurrentPath.value, data: payload, isHex: false })
        : await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: payload })
    if (res.ok && activeTerminalMode.value === 'local' && activeLocalSessionId.value) {
      recordLocalInput(activeLocalSessionId.value, payload)
    }
    snippetStatus.value = res.ok ? `片段原文已发送：${target.name}` : `片段发送失败：${res.error || '未知错误'}`
    focusTerminal()
  }

  return {
    executeSnippetTask,
    runSnippet,
    stopSnippet,
    getTerminalSnippet,
    runTerminalSnippet,
    executeSnippetOnLocalTerminal,
    sendSnippetRawToTerminal,
  }
}
