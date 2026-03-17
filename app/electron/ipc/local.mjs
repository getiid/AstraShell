export function registerLocalIpc(ipcMain, deps) {
  const {
    getLocalShellCommand,
    buildShellSpawnOptions,
    applyLocalShellRuntimeEnv,
    getNodePtySpawn,
    closeLocalShellSession,
    appendAuditLog,
    broadcast,
    logOutputLines,
    flushResponseLogsForSession,
    logCommandLines,
    localShellSessions,
    localInputBuffers,
    localOutputBuffers,
  } = deps

  ipcMain.handle('local:connect', async (_event, payload) => {
    const sessionId = String(payload?.sessionId || '').trim()
    if (!sessionId) return { ok: false, error: '缺少 sessionId' }
    closeLocalShellSession(sessionId, 'reconnect')
    const shellCmd = getLocalShellCommand()
    const options = buildShellSpawnOptions(String(payload?.cwd || '').trim())
    applyLocalShellRuntimeEnv(shellCmd, options.env)
    try {
      const ptySpawn = await getNodePtySpawn()
      const args = process.platform === 'win32' ? [] : ['-i', '-l']
      const proc = ptySpawn(shellCmd, args, {
        cwd: options.cwd,
        env: options.env,
        cols: Number(payload?.cols || 120),
        rows: Number(payload?.rows || 30),
        name: process.platform === 'win32' ? 'xterm-color' : 'xterm-256color',
      })
      const target = '本地终端'
      const sessionRef = { proc, target, silentClose: false }
      localShellSessions.set(sessionId, sessionRef)
      localInputBuffers.set(sessionId, '')
      localOutputBuffers.set(sessionId, '')

      proc.onData((chunk) => {
        const text = String(chunk || '')
        const buffer = Buffer.from(text, 'utf8')
        broadcast('local:data', {
          sessionId,
          data: text,
          dataBase64: buffer.toString('base64'),
        })
        logOutputLines(localOutputBuffers, sessionId, text, 'local', target)
      })
      proc.onExit(({ exitCode, signal }) => {
        const active = localShellSessions.get(sessionId)
        if (active !== sessionRef) {
          localInputBuffers.delete(sessionId)
          localOutputBuffers.delete(sessionId)
          return
        }
        localShellSessions.delete(sessionId)
        localInputBuffers.delete(sessionId)
        localOutputBuffers.delete(sessionId)
        flushResponseLogsForSession('local', sessionId)
        if (sessionRef.silentClose) return
        broadcast('local:close', { sessionId, code: Number(exitCode || 0), signal: String(signal || '') })
        appendAuditLog({
          source: 'local',
          action: 'disconnect',
          target: sessionRef.target || target,
          content: `终端已退出（code=${Number(exitCode || 0)}）`,
        })
      })
      appendAuditLog({ source: 'local', action: 'connect', target, content: `连接成功（目录：${options.cwd}）` })
      return { ok: true, shell: shellCmd, cwd: options.cwd }
    } catch (e) {
      const message = e?.message || '启动本地终端失败'
      appendAuditLog({ source: 'local', action: 'error', target: shellCmd, content: message, level: 'error' })
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('local:write', async (_event, payload) => {
    const sessionId = String(payload?.sessionId || '').trim()
    const session = localShellSessions.get(sessionId)
    if (!session) return { ok: false, error: '本地终端会话不存在' }
    const data = String(payload?.data || '')
    if (!data) return { ok: true }
    try {
      session.proc?.write?.(data)
    } catch {
      return { ok: false, error: '写入本地终端失败' }
    }
    logCommandLines(localInputBuffers, sessionId, data, 'local', session.target || sessionId)
    return { ok: true }
  })

  ipcMain.handle('local:resize', async (_event, payload) => {
    const sessionId = String(payload?.sessionId || '').trim()
    const session = localShellSessions.get(sessionId)
    if (!session) return { ok: false, error: '本地终端会话不存在' }
    const cols = Math.max(20, Number(payload?.cols || 120))
    const rows = Math.max(8, Number(payload?.rows || 30))
    try {
      session.proc?.resize?.(cols, rows)
      return { ok: true }
    } catch {
      return { ok: false, error: '调整终端尺寸失败' }
    }
  })

  ipcMain.handle('local:disconnect', async (_event, payload) => {
    const sessionId = String(payload?.sessionId || '').trim()
    if (!sessionId) return { ok: true }
    closeLocalShellSession(sessionId, 'manual')
    return { ok: true }
  })
}
