import { describe, expect, it } from 'vitest'
import {
  applySnippetCompletionText,
  collectSnippetCompletionSuggestions,
} from './useSnippetCommandCompletion'

describe('useSnippetCommandCompletion helpers', () => {
  it('prioritizes snippet history and host-aware suggestions', () => {
    const items = collectSnippetCompletionSuggestions({
      prefix: 'dock',
      snippetItems: [
        {
          id: 's1',
          commands: 'docker compose up -d\ndocker logs --tail 200 web',
          updatedAt: 20,
        },
      ],
      hostItems: [
        {
          id: 'h1',
          name: '生产',
          host: '10.0.0.8',
          port: 22,
          username: 'root',
        },
      ],
      selectedHostId: 'h1',
    })

    expect(items.length).toBeGreaterThan(0)
    expect(items[0]?.insertText).toContain('docker')
    expect(items.some((item) => item.insertText === 'docker compose up -d')).toBe(true)
  })

  it('returns host completion when prefix matches ssh command', () => {
    const items = collectSnippetCompletionSuggestions({
      prefix: 'ssh ro',
      snippetItems: [],
      hostItems: [
        {
          id: 'h1',
          host: '192.168.1.20',
          username: 'root',
          port: 2222,
        },
      ],
      selectedHostId: 'h1',
    })

    expect(items[0]?.insertText).toBe('ssh root@192.168.1.20 -p 2222')
  })

  it('replaces current line while preserving indentation', () => {
    const result = applySnippetCompletionText('echo 1\n  dock', 'echo 1\n  dock'.length, 'docker ps -a')
    expect(result.text).toBe('echo 1\n  docker ps -a')
    expect(result.cursor).toBe(result.text.length)
  })
})
