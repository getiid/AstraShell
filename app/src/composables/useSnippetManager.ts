import { computed, ref, watch, type Ref } from 'vue'

export type SnippetItem = {
  id: string
  name: string
  category: string
  hostId: string
  description: string
  commands: string
  createdAt: number
  updatedAt: number
}

type TerminalMode = 'ssh' | 'serial' | 'local'

type UseSnippetManagerParams = {
  hostItems: Ref<any[]>
  sshForm: Ref<{ host: string; port: number; username: string }>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  activeTerminalMode: Ref<TerminalMode>
  serialConnected: Ref<boolean>
  serialCurrentPath: Ref<string>
  localConnected: Readonly<Ref<boolean>>
  activeLocalSessionId: Readonly<Ref<string>>
  useHost: (host: any) => void
  connectSSH: (options?: { keepNav?: boolean } | Event) => Promise<boolean>
  focusTerminal: () => void
  defaultCategory?: string
  allCategory?: string
  legacyStorageKey?: string
}

const DEFAULT_SNIPPET_CATEGORY = '部署'
const ALL_SNIPPET_CATEGORY = '全部'
const LEGACY_STORAGE_KEY = 'astrashell.snippets.v1'

export function useSnippetManager(params: UseSnippetManagerParams) {
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
    useHost,
    connectSSH,
    focusTerminal,
    defaultCategory = DEFAULT_SNIPPET_CATEGORY,
    allCategory = ALL_SNIPPET_CATEGORY,
    legacyStorageKey = LEGACY_STORAGE_KEY,
  } = params

  const createEmptySnippet = (): SnippetItem => ({
    id: '',
    name: '',
    category: defaultCategory,
    hostId: '',
    description: '',
    commands: '',
    createdAt: 0,
    updatedAt: 0,
  })

  const snippetItems = ref<SnippetItem[]>([])
  const snippetsLoaded = ref(false)
  const snippetKeyword = ref('')
  const snippetCategory = ref(allCategory)
  const snippetStatus = ref('')
  const snippetRunDelayMs = ref(1200)
  const snippetRunning = ref(false)
  const snippetStopRequested = ref(false)
  const selectedSnippetId = ref('')
  const snippetEditorVisible = ref(true)
  const snippetEdit = ref<SnippetItem>(createEmptySnippet())
  const snippetExtraCategories = ref<string[]>([])
  const newSnippetCategoryName = ref('')
  const newSnippetCategoryInputVisible = ref(false)
  const terminalSnippetId = ref('')

  const snippetCategories = computed(() => {
    const set = new Set<string>([defaultCategory])
    snippetItems.value.forEach((item) => set.add(item.category || defaultCategory))
    snippetExtraCategories.value.forEach((category) => set.add(category))
    return Array.from(set)
  })

  const displaySnippetCategories = computed(() => [allCategory, ...snippetCategories.value])

  const filteredSnippetItems = computed(() => {
    const keyword = snippetKeyword.value.trim().toLowerCase()
    return snippetItems.value
      .filter((item) => {
        const inCategory = snippetCategory.value === allCategory || item.category === snippetCategory.value
        if (!inCategory) return false
        if (!keyword) return true
        return [item.name, item.description, item.commands]
          .some((value) => String(value || '').toLowerCase().includes(keyword))
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

  const currentSessionHostId = computed(() => {
    const host = hostItems.value.find((item) =>
      item.host === sshForm.value.host
      && Number(item.port || 22) === Number(sshForm.value.port || 22)
      && item.username === sshForm.value.username,
    )
    return host?.id || ''
  })

  const terminalSnippetItems = computed(() => {
    const currentHostId = currentSessionHostId.value
    return [...snippetItems.value].sort((a, b) => {
      const aMatched = !!currentHostId && a.hostId === currentHostId
      const bMatched = !!currentHostId && b.hostId === currentHostId
      if (aMatched !== bMatched) return aMatched ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  })

  const buildDefaultDockerSnippet = (): SnippetItem => ({
    id: `snippet-${Date.now().toString(36)}-docker`,
    name: '部署 Docker（Debian/Ubuntu）',
    category: defaultCategory,
    hostId: '',
    description: '安装 Docker CE、启动服务并加入当前用户组。',
    commands: [
      'sudo apt-get update',
      'sudo apt-get install -y ca-certificates curl gnupg',
      'sudo install -m 0755 -d /etc/apt/keyrings',
      'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
      'sudo chmod a+r /etc/apt/keyrings/docker.gpg',
      'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
      'sudo apt-get update',
      'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
      'sudo systemctl enable docker --now',
      'sudo usermod -aG docker $USER',
      'docker --version',
    ].join('\n'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  const readLegacySnippets = () => {
    try {
      const raw = localStorage.getItem(legacyStorageKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { items?: SnippetItem[]; extraCategories?: string[] }
      return {
        items: Array.isArray(parsed?.items) ? parsed.items : [],
        extraCategories: Array.isArray(parsed?.extraCategories) ? parsed.extraCategories : [],
      }
    } catch {
      return null
    }
  }

  const mergeSnippetSources = (
    remoteItems: SnippetItem[],
    remoteCategories: string[],
    legacyItems: SnippetItem[],
    legacyCategories: string[],
  ) => {
    const merged = [...remoteItems]
    let changed = false

    for (const item of legacyItems) {
      const legacyName = String(item?.name || '').trim()
      const legacyCommands = String(item?.commands || '').trim()
      if (!legacyName || !legacyCommands) continue

      const index = merged.findIndex((current) => (
        current.id === item.id
        || (
          String(current?.name || '').trim() === legacyName
          && String(current?.commands || '').trim() === legacyCommands
        )
      ))

      if (index === -1) {
        merged.push({ ...item })
        changed = true
        continue
      }

      if (Number(item.updatedAt || 0) > Number(merged[index]?.updatedAt || 0)) {
        merged[index] = { ...merged[index], ...item }
        changed = true
      }
    }

    const extraCategories = [...new Set(
      [...remoteCategories, ...legacyCategories]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    )]
    if (extraCategories.length !== remoteCategories.length) changed = true

    return {
      items: merged.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
      extraCategories,
      changed,
    }
  }

  const applySnippetState = (items: SnippetItem[], extraCategories: string[]) => {
    snippetItems.value = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
    snippetExtraCategories.value = [...new Set(extraCategories.filter(Boolean))]
  }

  const saveSnippetState = async (
    items = snippetItems.value,
    extraCategories = snippetExtraCategories.value,
  ) => {
    const plainItems = (Array.isArray(items) ? items : []).map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || ''),
      category: String(item?.category || ''),
      hostId: String(item?.hostId || ''),
      description: String(item?.description || ''),
      commands: String(item?.commands || ''),
      createdAt: Number(item?.createdAt || 0),
      updatedAt: Number(item?.updatedAt || 0),
    }))
    const plainExtraCategories = (Array.isArray(extraCategories) ? extraCategories : [])
      .map((value) => String(value || ''))

    const res = await window.lightterm.snippetsSetState({
      items: plainItems,
      extraCategories: plainExtraCategories,
    })
    if (!res.ok) {
      snippetStatus.value = `代码片段保存失败：${res.error || '未知错误'}`
      return false
    }
    applySnippetState((res.items || []) as SnippetItem[], res.extraCategories || [])
    return true
  }

  const restoreSnippets = async () => {
    try {
      const res = await window.lightterm.snippetsGetState()
      if (!res.ok) {
        applySnippetState([buildDefaultDockerSnippet()], [])
        await saveSnippetState()
        return
      }

      const remoteItems = Array.isArray(res.items) ? (res.items as SnippetItem[]) : []
      const remoteCategories = Array.isArray(res.extraCategories) ? res.extraCategories : []
      const legacy = readLegacySnippets()
      if (legacy && (legacy.items.length > 0 || legacy.extraCategories.length > 0)) {
        const merged = mergeSnippetSources(remoteItems, remoteCategories, legacy.items, legacy.extraCategories)
        applySnippetState(merged.items, merged.extraCategories)
        if (merged.changed || remoteItems.length === 0) {
          await saveSnippetState(merged.items, merged.extraCategories)
          snippetStatus.value = remoteItems.length > 0 || remoteCategories.length > 0
            ? '已合并本机旧版代码片段到共享数据库'
            : '已迁移本机旧版代码片段到共享数据库'
        }
        try { localStorage.removeItem(legacyStorageKey) } catch {}
        return
      }

      if (remoteItems.length > 0 || remoteCategories.length > 0) {
        applySnippetState(remoteItems, remoteCategories)
        return
      }

      applySnippetState([buildDefaultDockerSnippet()], [])
      await saveSnippetState()
    } finally {
      snippetsLoaded.value = true
    }
  }

  const openSnippetEditor = (item: SnippetItem) => {
    selectedSnippetId.value = item.id
    snippetEdit.value = { ...item }
    snippetEditorVisible.value = true
  }

  const clearSnippetEditor = () => {
    selectedSnippetId.value = ''
    snippetEdit.value = createEmptySnippet()
    snippetEditorVisible.value = true
  }

  const beginAddSnippetCategory = () => {
    newSnippetCategoryInputVisible.value = true
    newSnippetCategoryName.value = ''
  }

  const addSnippetCategory = async () => {
    const name = newSnippetCategoryName.value.trim()
    if (!name) {
      newSnippetCategoryInputVisible.value = false
      return
    }
    if (!snippetCategories.value.includes(name) && !snippetExtraCategories.value.includes(name)) {
      snippetExtraCategories.value.push(name)
      await saveSnippetState()
    }
    snippetCategory.value = name
    snippetEdit.value.category = name
    newSnippetCategoryName.value = ''
    newSnippetCategoryInputVisible.value = false
  }

  const saveSnippet = async () => {
    const draft = snippetEdit.value
    const name = draft.name.trim()
    const commands = draft.commands.trim()
    if (!name) {
      snippetStatus.value = '请填写片段名称'
      return
    }
    if (!commands) {
      snippetStatus.value = '请至少填写一条命令'
      return
    }

    const now = Date.now()
    const next: SnippetItem = {
      ...draft,
      id: draft.id || `snippet-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      category: draft.category || defaultCategory,
      hostId: draft.hostId || '',
      description: draft.description || '',
      commands,
      createdAt: draft.createdAt || now,
      updatedAt: now,
    }

    const index = snippetItems.value.findIndex((item) => item.id === next.id)
    if (index >= 0) {
      snippetItems.value.splice(index, 1, next)
    } else {
      snippetItems.value.unshift(next)
    }
    selectedSnippetId.value = next.id
    snippetEdit.value = { ...next }
    await saveSnippetState()
    snippetStatus.value = `片段已保存：${next.name}`
  }

  const deleteSnippet = async () => {
    const id = selectedSnippetId.value || snippetEdit.value.id
    if (!id) return
    const target = snippetItems.value.find((item) => item.id === id)
    if (!target) return
    const confirmed = window.confirm(`确定删除代码片段「${target.name}」吗？`)
    if (!confirmed) return
    snippetItems.value = snippetItems.value.filter((item) => item.id !== id)
    await saveSnippetState()
    clearSnippetEditor()
    snippetStatus.value = '片段已删除'
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const snippetCommandLines = (commands: string) => (
    commands
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !!line && !line.startsWith('#'))
  )

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
    if (!target?.id && !target?.commands?.trim()) {
      snippetStatus.value = '请先选择或创建代码片段'
      return
    }
    if (snippetRunning.value) {
      snippetStatus.value = '已有片段在执行中'
      return
    }

    const commands = snippetCommandLines(target.commands || '')
    if (commands.length === 0) {
      snippetStatus.value = '没有可执行命令（空行和 # 注释会自动跳过）'
      return
    }
    const ready = await ensureSnippetSession(target)
    if (!ready) return

    snippetRunning.value = true
    snippetStopRequested.value = false
    const delayMs = Math.max(200, Number(snippetRunDelayMs.value || 0))
    snippetStatus.value = `开始执行：${target.name || '未命名片段'}（共 ${commands.length} 条）`

    let sent = 0
    for (let i = 0; i < commands.length; i += 1) {
      if (snippetStopRequested.value) {
        snippetStatus.value = `已停止：${target.name || '未命名片段'}（已发送 ${sent}/${commands.length}）`
        break
      }
      const cmd = commands[i]
      snippetStatus.value = `执行中 ${i + 1}/${commands.length}：${cmd}`
      const res = await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: `${cmd}\n` })
      if (!res.ok) {
        snippetStatus.value = `第 ${i + 1} 条发送失败：${res.error || '未知错误'}`
        break
      }
      sent += 1
      if (i < commands.length - 1) await sleep(delayMs)
    }

    if (!snippetStopRequested.value && sent === commands.length) {
      snippetStatus.value = `发送完成：${target.name || '未命名片段'}（${commands.length} 条）`
    }
    snippetRunning.value = false
    snippetStopRequested.value = false
  }

  const stopSnippet = () => {
    if (!snippetRunning.value) return
    snippetStopRequested.value = true
  }

  const snippetHostLabel = (hostId: string) => {
    if (!hostId) return '当前 SSH 会话'
    const host = hostItems.value.find((item) => item.id === hostId)
    return host ? `${host.name} (${host.host})` : '未找到主机'
  }

  const getTerminalSnippet = () => {
    if (terminalSnippetId.value) {
      const matched = snippetItems.value.find((item) => item.id === terminalSnippetId.value)
      if (matched) return matched
    }
    if (selectedSnippetId.value) {
      const selected = snippetItems.value.find((item) => item.id === selectedSnippetId.value)
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
    snippetStatus.value = res.ok ? `片段原文已发送：${target.name}` : `片段发送失败：${res.error || '未知错误'}`
    focusTerminal()
  }

  watch(snippetItems, (items) => {
    if (!items.some((item) => item.id === terminalSnippetId.value)) {
      terminalSnippetId.value = items[0]?.id || ''
    }
  }, { immediate: true })

  return {
    snippetItems,
    snippetsLoaded,
    snippetKeyword,
    snippetCategory,
    snippetStatus,
    snippetRunDelayMs,
    snippetRunning,
    snippetStopRequested,
    selectedSnippetId,
    snippetEditorVisible,
    snippetEdit,
    snippetExtraCategories,
    newSnippetCategoryName,
    newSnippetCategoryInputVisible,
    terminalSnippetId,
    snippetCategories,
    displaySnippetCategories,
    filteredSnippetItems,
    currentSessionHostId,
    terminalSnippetItems,
    createEmptySnippet,
    restoreSnippets,
    openSnippetEditor,
    clearSnippetEditor,
    beginAddSnippetCategory,
    addSnippetCategory,
    saveSnippet,
    deleteSnippet,
    snippetCommandLines,
    runSnippet,
    stopSnippet,
    snippetHostLabel,
    getTerminalSnippet,
    runTerminalSnippet,
    sendSnippetRawToTerminal,
  }
}
