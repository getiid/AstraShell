import { remoteConnSchema, safeParse, sshConnectSchema, sshResizeSchema, sshSessionIdSchema, sshWriteSchema } from './schemas.mjs'

export function registerSshIpc(ipcMain, deps) {
  const {
    createSSHClient,
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

  ipcMain.handle('ssh:test', async (_event, config) => {
    const parsed = safeParse(remoteConnSchema, config)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedConfig = parsed.data
    const conn = await createSSHClient()
    return await new Promise((resolve) => {
      attachKeyboardHandler(conn, validatedConfig.password)
      conn.on('ready', () => { conn.end(); resolve({ ok: true }) }).on('error', (err) => resolve({ ok: false, error: err.message })).connect(connectConfigFromPayload(validatedConfig))
    })
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
      try { existing.stream.end('exit\n') } catch {}
      try { existing.conn.end() } catch {}
      sshSessions.delete(sessionId)
      sshInputBuffers.delete(sessionId)
      sshOutputBuffers.delete(sessionId)
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
        const message = err?.message || 'SSH 连接失败'
        appendAuditLog({ source: 'ssh', action: 'error', target, content: message, level: 'error' })
        broadcast('ssh:error', { sessionId, error: message })
        finish({ ok: false, error: message })
      }).connect(connectConfigFromPayload(validatedPayload))
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
    session.stream.write(data)
    const target = String(session?.target || `${session?.conn?.config?.username || 'user'}@${session?.conn?.config?.host || 'host'}:${Number(session?.conn?.config?.port || 22)}`)
    logCommandLines(sshInputBuffers, sessionId, data, 'ssh', target)
    return { ok: true }
  })

  ipcMain.handle('ssh:resize', async (_event, payload) => {
    const parsed = safeParse(sshResizeSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    const session = sshSessions.get(validatedPayload.sessionId)
    if (!session) return { ok: false, error: 'SSH 会话不存在' }
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
    session.stream.end('exit\n'); session.conn.end(); sshSessions.delete(sessionId); sshInputBuffers.delete(sessionId); sshOutputBuffers.delete(sessionId)
    flushResponseLogsForSession('ssh', sessionId)
    appendAuditLog({ source: 'ssh', action: 'disconnect', target, content: '用户手动断开' })
    return { ok: true }
  })
}
