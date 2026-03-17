export type QuickConnectParseResult =
  | { ok: true; username: string; host: string; port: number }
  | { ok: false; error: string }

export function formatQuickConnectValue(host: { host?: string; username?: string; port?: number }) {
  const username = String(host?.username || 'root').trim() || 'root'
  const address = String(host?.host || '').trim()
  const port = Number(host?.port || 22)
  if (!address) return ''
  return port && port !== 22 ? `${username}@${address}:${port}` : `${username}@${address}`
}

export function parseQuickConnectInput(rawValue: string): QuickConnectParseResult {
  const raw = String(rawValue || '').trim().replace(/^ssh\s+/i, '')
  if (!raw) return { ok: false, error: '请输入 SSH 地址，例如 root@1.2.3.4' }
  if (/\s/.test(raw)) return { ok: false, error: '快速连接仅支持 user@host 或 user@host:port' }

  let username = 'root'
  let hostPart = raw
  const atIndex = raw.lastIndexOf('@')
  if (atIndex >= 0) {
    username = raw.slice(0, atIndex).trim() || 'root'
    hostPart = raw.slice(atIndex + 1).trim()
  }
  if (!hostPart) return { ok: false, error: '缺少主机地址' }

  let host = hostPart
  let port = 22
  const colonIndex = hostPart.lastIndexOf(':')
  if (colonIndex > 0 && hostPart.indexOf(':') === colonIndex) {
    const maybePort = Number(hostPart.slice(colonIndex + 1))
    if (!Number.isFinite(maybePort) || maybePort <= 0) return { ok: false, error: '端口格式无效' }
    host = hostPart.slice(0, colonIndex).trim()
    port = maybePort
  }
  if (!host) return { ok: false, error: '缺少主机地址' }
  return { ok: true, username, host, port }
}
