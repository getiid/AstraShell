import { remoteConnSchema, safeParse, sshConnectSchema, sshExecScriptSchema, sshInspectPathSchema, sshResizeSchema, sshSessionIdSchema, sshWriteSchema } from './schemas.mjs'

const SSH_METRICS_COMMAND = `LC_ALL=C sh -lc '
host=$(hostname 2>/dev/null | head -n 1)
user=$(id -un 2>/dev/null || whoami 2>/dev/null)
cwd=$(pwd 2>/dev/null)
kernel=$(uname -srmo 2>/dev/null | head -n 1)
os=$(awk -F= "/^PRETTY_NAME=/{gsub(/^\\"|\\"$/, \\"\\", \\$2); print \\$2; exit}" /etc/os-release 2>/dev/null)
shell_name=$(printf "%s" "\${SHELL:-}" | awk -F"/" "{print \\$NF}")
uptime_text=$(uptime -p 2>/dev/null | sed "s/^up //" )
load=$(awk "{print \\$1, \\$2, \\$3}" /proc/loadavg 2>/dev/null)
cpu1=$(awk "/^cpu /{idle=\\$5+\\$6; total=0; for(i=2;i<=NF;i++) total+=\\$i; print total, idle; exit}" /proc/stat 2>/dev/null)
sleep 0.2
cpu2=$(awk "/^cpu /{idle=\\$5+\\$6; total=0; for(i=2;i<=NF;i++) total+=\\$i; print total, idle; exit}" /proc/stat 2>/dev/null)
mem=$(awk "/^MemTotal:/{t=\\$2} /^MemAvailable:/{a=\\$2} END{print t+0, a+0}" /proc/meminfo 2>/dev/null)
disk=$(df -kP / 2>/dev/null | awk "NR==2 {gsub(/%/, \\"\\", \\$5); print \\$2+0, \\$3+0, \\$5+0}")
net=$(awk -F "[: ]+" "BEGIN{rx=0;tx=0} NR>2 && \\$1 != \\"lo\\" {rx+=\\$3; tx+=\\$11} END{print rx+0, tx+0}" /proc/net/dev 2>/dev/null)
printf "host=%s\\nuser=%s\\ncwd=%s\\nkernel=%s\\nos=%s\\nshell=%s\\nuptime=%s\\nload=%s\\ncpu1=%s\\ncpu2=%s\\nmem=%s\\ndisk=%s\\nnet=%s\\n" "$host" "$user" "$cwd" "$kernel" "$os" "$shell_name" "$uptime_text" "$load" "$cpu1" "$cpu2" "$mem" "$disk" "$net"
'`

function shellSingleQuote(value) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`
}

function buildInspectPathCommand(pathValue) {
  const escapedPath = shellSingleQuote(pathValue || '.')
  return `LC_ALL=C sh -lc '
target=${escapedPath}
cd -- "$target" 2>/dev/null || exit 9
cwd=$(pwd -P 2>/dev/null || pwd 2>/dev/null)
dirs=$(find . -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | awk "{print \\$1}")
files=$(find . -mindepth 1 -maxdepth 1 -type f 2>/dev/null | wc -l | awk "{print \\$1}")
total=$(find . -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | awk "{print \\$1}")
size=$(du -sh . 2>/dev/null | awk "{print \\$1}")
printf "cwd=%s\\ndirs=%s\\nfiles=%s\\ntotal=%s\\nsize=%s\\n" "$cwd" "$dirs" "$files" "$total" "$size"
find . -mindepth 1 -maxdepth 1 -printf "%y\\t%f\\n" 2>/dev/null | sort | head -n 8 | while IFS="$(printf "\\t")" read -r kind name; do
  printf "item=%s\\t%s\\n" "$kind" "$name"
done
'`
}

function normalizeSshErrorMessage(error) {
  const message = String(error?.message || error || 'SSH 连接失败').trim() || 'SSH 连接失败'
  if (/All configured authentication methods failed/i.test(message)) {
    return '认证失败，请检查密码、密钥或认证方式'
  }
  return message
}

function shouldUseInteractiveSsh(payload) {
  return !String(payload?.password || '').trim() && !String(payload?.privateKey || '').trim()
}

function buildInteractiveSshArgs(payload) {
  return [
    '-tt',
    '-p',
    String(Number(payload?.port || 22)),
    '-o', 'PreferredAuthentications=keyboard-interactive,password,publickey',
    '-o', 'NumberOfPasswordPrompts=3',
    `${String(payload?.username || '').trim()}@${String(payload?.host || '').trim()}`,
  ]
}

function isSecretPromptText(text) {
  const value = String(text || '')
  return /(password|passphrase|verification code|one-time code|otp|验证码|口令)/i.test(value)
}

function runSshExec(session, command, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let streamRef = null
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { streamRef?.close?.() } catch {}
      reject(new Error('采集服务器状态超时'))
    }, timeoutMs)

    session.conn.exec(command, (err, stream) => {
      if (settled) return
      if (err) {
        clearTimeout(timer)
        settled = true
        reject(err)
        return
      }
      streamRef = stream
      const chunks = []
      const errs = []
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      stream.stderr?.on?.('data', (chunk) => errs.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      stream.on('close', () => {
        if (settled) return
        clearTimeout(timer)
        settled = true
        const stderr = Buffer.concat(errs).toString('utf8').trim()
        if (stderr && chunks.length === 0) {
          reject(new Error(stderr))
          return
        }
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      stream.on('error', (error) => {
        if (settled) return
        clearTimeout(timer)
        settled = true
        reject(error)
      })
    })
  })
}

function parseMetricPair(rawValue) {
  return String(rawValue || '')
    .trim()
    .split(/\s+/)
    .map((value) => Number(value || 0))
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function parseServerMetricOutput(rawText) {
  const rows = Object.fromEntries(
    String(rawText || '')
      .split(/\r?\n/)
      .map((line) => {
        const index = line.indexOf('=')
        if (index <= 0) return null
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      })
      .filter(Boolean),
  )

  const [cpuTotal1, cpuIdle1] = parseMetricPair(rows.cpu1)
  const [cpuTotal2, cpuIdle2] = parseMetricPair(rows.cpu2)
  const [memTotalKb, memAvailableKb] = parseMetricPair(rows.mem)
  const [diskTotalKb, diskUsedKb, diskPercentRaw] = parseMetricPair(rows.disk)
  const [rxBytes, txBytes] = parseMetricPair(rows.net)

  const cpuTotalDelta = Math.max(0, cpuTotal2 - cpuTotal1)
  const cpuIdleDelta = Math.max(0, cpuIdle2 - cpuIdle1)
  const cpuPercent = cpuTotalDelta > 0
    ? clampPercent(((cpuTotalDelta - cpuIdleDelta) / cpuTotalDelta) * 100)
    : null
  const memoryUsedKb = Math.max(0, memTotalKb - memAvailableKb)
  const memoryPercent = memTotalKb > 0 ? clampPercent((memoryUsedKb / memTotalKb) * 100) : null
  const diskPercent = diskTotalKb > 0
    ? clampPercent(diskPercentRaw > 0 ? diskPercentRaw : (diskUsedKb / diskTotalKb) * 100)
    : null

  return {
    supported: !!(cpuTotal1 || cpuTotal2 || memTotalKb || diskTotalKb || rxBytes || txBytes),
    host: String(rows.host || '').trim(),
    user: String(rows.user || '').trim(),
    cwd: String(rows.cwd || '').trim(),
    kernel: String(rows.kernel || '').trim(),
    os: String(rows.os || '').trim(),
    shell: String(rows.shell || '').trim(),
    uptime: String(rows.uptime || '').trim(),
    loadAverage: String(rows.load || '').trim(),
    cpuPercent,
    memoryPercent,
    diskPercent,
    memoryUsedKb,
    memoryTotalKb: memTotalKb,
    diskUsedKb,
    diskTotalKb,
    rxBytes,
    txBytes,
  }
}

function parseInspectPathOutput(rawText) {
  const snapshot = {
    cwd: '',
    dirs: 0,
    files: 0,
    total: 0,
    size: '--',
    items: [],
  }
  String(rawText || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const value = String(line || '')
      if (!value) return
      if (value.startsWith('item=')) {
        const [kind = '', name = ''] = value.slice(5).split('\t')
        if (!name) return
        snapshot.items.push({
          kind: String(kind || '').trim(),
          name: String(name || '').trim(),
        })
        return
      }
      const index = value.indexOf('=')
      if (index <= 0) return
      const key = value.slice(0, index).trim()
      const raw = value.slice(index + 1).trim()
      if (key === 'cwd') snapshot.cwd = raw
      if (key === 'dirs') snapshot.dirs = Number(raw || 0)
      if (key === 'files') snapshot.files = Number(raw || 0)
      if (key === 'total') snapshot.total = Number(raw || 0)
      if (key === 'size') snapshot.size = raw || '--'
    })
  return snapshot
}

function runStandaloneSshScript({
  createSSHClient,
  attachKeyboardHandler,
  connectConfigFromPayload,
  payload,
}) {
  return createSSHClient().then((conn) => new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try { conn.end() } catch {}
      resolve(value)
    }

    attachKeyboardHandler(conn, payload.password)
    timer = setTimeout(() => {
      finish({ ok: false, error: '脚本执行超时' })
    }, Number(payload.timeoutMs || 120000))

    conn.on('ready', () => {
      conn.exec('sh -se', (err, stream) => {
        if (err) {
          finish({ ok: false, error: err.message || '脚本执行失败' })
          return
        }
        const stdout = []
        const stderr = []
        let exitCode = 0
        stream.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        stream.stderr?.on?.('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        stream.on('exit', (code) => {
          exitCode = Number(code || 0)
        })
        stream.on('close', () => {
          const out = Buffer.concat(stdout).toString('utf8')
          const errText = Buffer.concat(stderr).toString('utf8')
          finish({
            ok: exitCode === 0,
            code: exitCode,
            stdout: out,
            stderr: errText,
            error: exitCode === 0 ? '' : (errText.trim() || `脚本退出码 ${exitCode}`),
          })
        })
        stream.on('error', (error) => {
          finish({ ok: false, error: error?.message || '脚本执行失败' })
        })
        stream.write(`set -e\nexport LC_ALL=C\n${String(payload.script || '').trim()}\n`)
        stream.end()
      })
    }).on('error', (err) => {
      finish({ ok: false, error: err?.message || 'SSH 连接失败' })
    }).connect(connectConfigFromPayload(payload))
  }))
}

export function registerSshIpc(ipcMain, deps) {
  const {
    createSSHClient,
    getNodePtySpawn,
    attachKeyboardHandler,
    connectConfigFromPayload,
    buildShellColorInitScript,
    appendAuditLog,
    broadcast,
    logOutputLines,
    flushResponseLogsForSession,
    logCommandLines,
    sshSessions,
    sshInputBuffers,
    sshOutputBuffers,
  } = deps
  const metricSamples = new Map()

  ipcMain.handle('ssh:test', async (_event, config) => {
    const parsed = safeParse(remoteConnSchema, config)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedConfig = parsed.data
    const conn = await createSSHClient()
    return await new Promise((resolve) => {
      attachKeyboardHandler(conn, validatedConfig.password)
      conn.on('ready', () => { conn.end(); resolve({ ok: true }) }).on('error', (err) => resolve({ ok: false, error: normalizeSshErrorMessage(err) })).connect(connectConfigFromPayload(validatedConfig))
    })
  })

  ipcMain.handle('ssh:list', async () => {
    const items = [...sshSessions.entries()].map(([sessionId, session]) => ({
      sessionId,
      target: String(session?.target || ''),
    }))
    return { ok: true, items }
  })

  ipcMain.handle('ssh:connect', async (_event, payload) => {
    const parsed = safeParse(sshConnectSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    const sessionId = validatedPayload.sessionId
    const targetBase = `${validatedPayload.username}@${validatedPayload.host}:${Number(validatedPayload.port || 22)}`
    const displayName = String(validatedPayload.displayName || '').trim()
    const target = displayName ? `${displayName} (${targetBase})` : targetBase
    const existing = sshSessions.get(sessionId)
    if (existing) {
      existing.silentClose = true
      if (existing?.mode === 'pty') {
        try { existing.proc.kill() } catch {}
      } else {
        try { existing.stream.end('exit\n') } catch {}
        try { existing.conn.end() } catch {}
      }
      sshSessions.delete(sessionId)
      sshInputBuffers.delete(sessionId)
      sshOutputBuffers.delete(sessionId)
    }
    if (shouldUseInteractiveSsh(validatedPayload)) {
      try {
        const ptySpawn = await getNodePtySpawn()
        const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
        const proc = ptySpawn(sshCommand, buildInteractiveSshArgs(validatedPayload), {
          cols: 120,
          rows: 30,
          env: process.env,
          name: process.platform === 'win32' ? 'xterm-color' : 'xterm-256color',
        })
        return await new Promise((resolve) => {
          let settled = false
          const finish = (value) => {
            if (settled) return
            settled = true
            resolve(value)
          }
          const sessionRef = {
            mode: 'pty',
            proc,
            target,
            silentClose: false,
            expectingSecret: false,
          }
          sshSessions.set(sessionId, sessionRef)
          sshInputBuffers.set(sessionId, '')
          sshOutputBuffers.set(sessionId, '')
          proc.onData((chunk) => {
            const text = String(chunk || '')
            const buffer = Buffer.from(text, 'utf8')
            if (isSecretPromptText(text)) {
              sessionRef.expectingSecret = true
              sshInputBuffers.set(sessionId, '')
            }
            broadcast('ssh:data', {
              sessionId,
              data: text,
              dataBase64: buffer.toString('base64'),
            })
            logOutputLines(sshOutputBuffers, sessionId, text, 'ssh', target)
          })
          proc.onExit(({ exitCode, signal }) => {
            const active = sshSessions.get(sessionId)
            if (active === sessionRef) {
              sshSessions.delete(sessionId)
              sshInputBuffers.delete(sessionId)
              sshOutputBuffers.delete(sessionId)
              metricSamples.delete(sessionId)
              flushResponseLogsForSession('ssh', sessionId)
            }
            if (sessionRef.silentClose) {
              finish({ ok: true })
              return
            }
            broadcast('ssh:close', { sessionId })
            appendAuditLog({ source: 'ssh', action: 'disconnect', target, content: `远程会话已关闭（code=${Number(exitCode || 0)}${signal ? `, signal=${String(signal)}` : ''}）` })
            finish({ ok: true })
          })
          appendAuditLog({ source: 'ssh', action: 'connect', target, content: '已启动系统 SSH 终端，等待交互认证' })
          finish({ ok: true })
        })
      } catch (err) {
        const message = normalizeSshErrorMessage(err)
        appendAuditLog({ source: 'ssh', action: 'error', target, content: message, level: 'error' })
        broadcast('ssh:error', { sessionId, error: message })
        return { ok: false, error: message }
      }
    }

    const conn = await createSSHClient()
    attachKeyboardHandler(conn, validatedPayload.password)
    return await new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      conn.on('ready', () => {
        conn.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
          if (err) return finish({ ok: false, error: err.message })
          const sessionRef = { conn, stream, target, silentClose: false }
          sshSessions.set(sessionId, sessionRef)
          sshOutputBuffers.set(sessionId, '')
          stream.on('data', (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            const text = buffer.toString('utf8')
            broadcast('ssh:data', {
              sessionId,
              data: text,
              dataBase64: buffer.toString('base64'),
            })
            logOutputLines(sshOutputBuffers, sessionId, text, 'ssh', target)
          })
          stream.on('close', () => {
            const active = sshSessions.get(sessionId)
            if (active === sessionRef) {
              sshSessions.delete(sessionId)
              sshInputBuffers.delete(sessionId)
              sshOutputBuffers.delete(sessionId)
              metricSamples.delete(sessionId)
              flushResponseLogsForSession('ssh', sessionId)
            }
            if (sessionRef.silentClose) {
              conn.end()
              return
            }
            broadcast('ssh:close', { sessionId })
            appendAuditLog({ source: 'ssh', action: 'disconnect', target, content: '远程会话已关闭' })
            conn.end()
          })
          const sshColorInit = buildShellColorInitScript()
          setTimeout(() => {
            try { stream.write(`${sshColorInit}\n`) } catch {}
          }, 80)
          appendAuditLog({ source: 'ssh', action: 'connect', target, content: '连接成功' })
          finish({ ok: true })
        })
      }).on('error', (err) => {
        const message = normalizeSshErrorMessage(err)
        appendAuditLog({ source: 'ssh', action: 'error', target, content: message, level: 'error' })
        broadcast('ssh:error', { sessionId, error: message })
        finish({ ok: false, error: message })
      }).connect(connectConfigFromPayload(validatedPayload))
    })
  })

  ipcMain.handle('ssh:exec-script', async (_event, payload) => {
    const parsed = safeParse(sshExecScriptSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    return await runStandaloneSshScript({
      createSSHClient,
      attachKeyboardHandler,
      connectConfigFromPayload,
      payload: parsed.data,
    })
  })

  ipcMain.handle('ssh:write', async (_event, payload) => {
    const parsed = safeParse(sshWriteSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    const session = sshSessions.get(validatedPayload.sessionId)
    if (!session) return { ok: false, error: 'SSH 会话不存在' }
    const sessionId = String(validatedPayload.sessionId || '')
    const data = String(validatedPayload.data || '')
    const target = String(session?.target || `${session?.conn?.config?.username || 'user'}@${session?.conn?.config?.host || 'host'}:${Number(session?.conn?.config?.port || 22)}`)
    if (session?.mode === 'pty') {
      session.proc.write(data)
      if (session.expectingSecret) {
        if (/[\r\n]/.test(data)) {
          flushResponseLogsForSession('ssh', sessionId)
          appendAuditLog({ source: 'ssh', action: 'command', target, content: '[已输入认证信息]' })
          session.expectingSecret = false
          sshInputBuffers.set(sessionId, '')
        }
      } else {
        logCommandLines(sshInputBuffers, sessionId, data, 'ssh', target)
      }
      return { ok: true }
    }
    session.stream.write(data)
    logCommandLines(sshInputBuffers, sessionId, data, 'ssh', target)
    return { ok: true }
  })

  ipcMain.handle('ssh:resize', async (_event, payload) => {
    const parsed = safeParse(sshResizeSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    const session = sshSessions.get(validatedPayload.sessionId)
    if (!session) return { ok: false, error: 'SSH 会话不存在' }
    if (session?.mode === 'pty') {
      try { session.proc.resize(validatedPayload.cols || 120, validatedPayload.rows || 30) } catch {}
      return { ok: true }
    }
    session.stream.setWindow(validatedPayload.rows || 30, validatedPayload.cols || 120, 0, 0)
    return { ok: true }
  })

  ipcMain.handle('ssh:disconnect', async (_event, payload) => {
    const parsed = safeParse(sshSessionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const { sessionId } = parsed.data
    const session = sshSessions.get(sessionId)
    if (!session) return { ok: true }
    const target = String(session?.target || `${session?.conn?.config?.username || 'user'}@${session?.conn?.config?.host || 'host'}:${Number(session?.conn?.config?.port || 22)}`)
    session.silentClose = true
    if (session?.mode === 'pty') {
      try { session.proc.kill() } catch {}
    } else {
      session.stream.end('exit\n')
      session.conn.end()
    }
    sshSessions.delete(sessionId); sshInputBuffers.delete(sessionId); sshOutputBuffers.delete(sessionId)
    metricSamples.delete(sessionId)
    flushResponseLogsForSession('ssh', sessionId)
    appendAuditLog({ source: 'ssh', action: 'disconnect', target, content: '用户手动断开' })
    return { ok: true }
  })

  ipcMain.handle('ssh:metrics', async (_event, payload) => {
    const parsed = safeParse(sshSessionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const { sessionId } = parsed.data
    const session = sshSessions.get(sessionId)
    if (!session) return { ok: false, error: 'SSH 会话不存在' }
    if (!session?.conn) {
      return { ok: true, supported: false, metrics: null, error: '' }
    }
    try {
      const output = await runSshExec(session, SSH_METRICS_COMMAND, 6000)
      const nextMetrics = parseServerMetricOutput(output)
      if (!nextMetrics.supported) {
        return { ok: true, supported: false, metrics: null, error: '' }
      }
      const now = Date.now()
      const prev = metricSamples.get(sessionId)
      let rxBytesPerSec = 0
      let txBytesPerSec = 0
      if (prev && now > prev.ts) {
        const elapsedMs = now - prev.ts
        if (elapsedMs > 0) {
          rxBytesPerSec = Math.max(0, ((nextMetrics.rxBytes || 0) - (prev.rxBytes || 0)) * 1000 / elapsedMs)
          txBytesPerSec = Math.max(0, ((nextMetrics.txBytes || 0) - (prev.txBytes || 0)) * 1000 / elapsedMs)
        }
      }
      metricSamples.set(sessionId, {
        ts: now,
        rxBytes: nextMetrics.rxBytes || 0,
        txBytes: nextMetrics.txBytes || 0,
      })
      return {
        ok: true,
        supported: true,
        metrics: {
          host: nextMetrics.host,
          user: nextMetrics.user,
          cwd: nextMetrics.cwd,
          kernel: nextMetrics.kernel,
          os: nextMetrics.os,
          shell: nextMetrics.shell,
          uptime: nextMetrics.uptime,
          loadAverage: nextMetrics.loadAverage,
          cpuPercent: nextMetrics.cpuPercent,
          memoryPercent: nextMetrics.memoryPercent,
          diskPercent: nextMetrics.diskPercent,
          memoryUsedKb: nextMetrics.memoryUsedKb,
          memoryTotalKb: nextMetrics.memoryTotalKb,
          diskUsedKb: nextMetrics.diskUsedKb,
          diskTotalKb: nextMetrics.diskTotalKb,
          rxBytesPerSec,
          txBytesPerSec,
        },
      }
    } catch (error) {
      return { ok: false, error: error?.message || '读取服务器状态失败' }
    }
  })

  ipcMain.handle('ssh:inspect-path', async (_event, payload) => {
    const parsed = safeParse(sshInspectPathSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const { sessionId, path } = parsed.data
    const session = sshSessions.get(sessionId)
    if (!session) return { ok: false, error: 'SSH 会话不存在' }
    if (!session?.conn) return { ok: false, error: 'SSH 会话不可用' }
    try {
      const output = await runSshExec(session, buildInspectPathCommand(path), 6000)
      return {
        ok: true,
        snapshot: parseInspectPathOutput(output),
      }
    } catch (error) {
      const message = String(error?.message || '目录读取失败')
      if (/exit 9|No such file|can.t cd/i.test(message)) {
        return { ok: false, error: '目录不存在或无权限访问' }
      }
      return { ok: false, error: message }
    }
  })
}
