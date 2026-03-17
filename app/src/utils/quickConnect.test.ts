import { describe, expect, it } from 'vitest'
import { formatQuickConnectValue, parseQuickConnectInput } from './quickConnect'

describe('quickConnect', () => {
  it('formats host with default port', () => {
    expect(formatQuickConnectValue({ username: 'root', host: '1.2.3.4', port: 22 })).toBe('root@1.2.3.4')
  })

  it('formats host with custom port', () => {
    expect(formatQuickConnectValue({ username: 'admin', host: '1.2.3.4', port: 2222 })).toBe('admin@1.2.3.4:2222')
  })

  it('parses user host and port', () => {
    expect(parseQuickConnectInput('admin@1.2.3.4:2200')).toEqual({
      ok: true,
      username: 'admin',
      host: '1.2.3.4',
      port: 2200,
    })
  })

  it('defaults username and port', () => {
    expect(parseQuickConnectInput('example.com')).toEqual({
      ok: true,
      username: 'root',
      host: 'example.com',
      port: 22,
    })
  })

  it('rejects invalid input with spaces', () => {
    const parsed = parseQuickConnectInput('root@1.2.3.4 -p 22')
    expect(parsed.ok).toBe(false)
  })
})
