import { computed, nextTick, ref, watch, type Ref } from 'vue'

type SnippetLike = {
  id?: string
  name?: string
  commands?: string
  updatedAt?: number
}

type HostLike = {
  id?: string
  name?: string
  host?: string
  port?: number
  username?: string
}

export type SnippetCompletionItem = {
  key: string
  label: string
  insertText: string
  detail: string
  source: '模板' | '历史' | '主机'
  score: number
}

type CollectSnippetCompletionParams = {
  prefix: string
  snippetItems: SnippetLike[]
  hostItems: HostLike[]
  selectedHostId?: string
  limit?: number
}

type UseSnippetCommandCompletionParams = {
  model: Ref<string>
  snippetItems: Ref<SnippetLike[]>
  hostItems: Ref<HostLike[]>
  selectedHostId: Ref<string>
}

const BASE_COMMAND_TEMPLATES: Array<Omit<SnippetCompletionItem, 'key' | 'score'>> = [
  { label: 'sudo systemctl status ', insertText: 'sudo systemctl status ', detail: '查看服务状态', source: '模板' },
  { label: 'sudo systemctl restart ', insertText: 'sudo systemctl restart ', detail: '重启服务', source: '模板' },
  { label: 'sudo journalctl -u  -n 200 --no-pager', insertText: 'sudo journalctl -u  -n 200 --no-pager', detail: '查看最近日志', source: '模板' },
  { label: 'docker ps -a', insertText: 'docker ps -a', detail: '查看容器列表', source: '模板' },
  { label: 'docker logs --tail 200 ', insertText: 'docker logs --tail 200 ', detail: '查看容器日志', source: '模板' },
  { label: 'docker compose ps', insertText: 'docker compose ps', detail: '查看 Compose 服务状态', source: '模板' },
  { label: 'docker compose up -d', insertText: 'docker compose up -d', detail: '后台启动 Compose 服务', source: '模板' },
  { label: 'git status', insertText: 'git status', detail: '查看工作区状态', source: '模板' },
  { label: 'git pull --rebase', insertText: 'git pull --rebase', detail: '拉取并 rebase', source: '模板' },
  { label: 'pnpm install', insertText: 'pnpm install', detail: '安装依赖', source: '模板' },
  { label: 'npm run dev', insertText: 'npm run dev', detail: '启动开发环境', source: '模板' },
  { label: 'tail -f /var/log/', insertText: 'tail -f /var/log/', detail: '持续跟踪日志文件', source: '模板' },
  { label: 'grep -RIn "" .', insertText: 'grep -RIn "" .', detail: '递归搜索文本', source: '模板' },
  { label: 'find . -type f | head', insertText: 'find . -type f | head', detail: '查看当前目录文件', source: '模板' },
  { label: 'curl -I http://127.0.0.1:', insertText: 'curl -I http://127.0.0.1:', detail: '探测本地 HTTP 服务', source: '模板' },
  { label: 'ss -lntp | grep ', insertText: 'ss -lntp | grep ', detail: '查看监听端口', source: '模板' },
  { label: 'ps aux | grep ', insertText: 'ps aux | grep ', detail: '查看进程', source: '模板' },
  { label: 'chmod +x ', insertText: 'chmod +x ', detail: '添加可执行权限', source: '模板' },
]

const normalizeKeyword = (value: string) => String(value || '').trim().toLowerCase()

const getLineStart = (text: string, cursor: number) => {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  return text.lastIndexOf('\n', safeCursor - 1) + 1
}

export const getCurrentLinePrefix = (text: string, cursor: number) => {
  const lineStart = getLineStart(text, cursor)
  const currentLine = text.slice(lineStart, cursor)
  const indent = currentLine.match(/^\s*/)?.[0] || ''
  const content = currentLine.slice(indent.length)
  return {
    lineStart,
    currentLine,
    indent,
    content,
  }
}

const scoreCompletion = (prefix: string, candidate: string, source: SnippetCompletionItem['source']) => {
  const normalizedPrefix = normalizeKeyword(prefix)
  const normalizedCandidate = normalizeKeyword(candidate)
  if (!normalizedPrefix || !normalizedCandidate) return -1
  if (normalizedCandidate === normalizedPrefix) return -1

  let score = 0
  if (normalizedCandidate.startsWith(normalizedPrefix)) score += 140
  else if (normalizedCandidate.includes(normalizedPrefix)) score += 70
  else return -1

  if (source === '历史') score += 20
  if (source === '主机') score += 12
  score -= Math.min(normalizedCandidate.length, 80) / 10
  return score
}

const collectHistorySuggestions = (items: SnippetLike[]) => {
  const seen = new Map<string, number>()
  for (const item of items) {
    const lines = String(item?.commands || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !!line && !line.startsWith('#'))
    for (const line of lines) {
      const weight = Number(item?.updatedAt || 0)
      const previous = seen.get(line) || 0
      seen.set(line, Math.max(previous, weight))
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([line]) => ({
      label: line,
      insertText: line,
      detail: '来自已有代码片段',
      source: '历史' as const,
    }))
}

const collectHostSuggestions = (items: HostLike[], selectedHostId?: string) => {
  const normalizedHosts = items
    .filter((item) => item?.host && item?.username)
    .sort((a, b) => (a.id === selectedHostId ? -1 : b.id === selectedHostId ? 1 : 0))

  return normalizedHosts.slice(0, 4).flatMap((item) => {
    const host = String(item.host)
    const username = String(item.username)
    const port = Number(item.port || 22)
    const alias = item.name ? `${item.name} ${host}` : host
    return [
      {
        label: `ssh ${username}@${host}${port !== 22 ? ` -p ${port}` : ''}`,
        insertText: `ssh ${username}@${host}${port !== 22 ? ` -p ${port}` : ''}`,
        detail: `连接 ${alias}`,
        source: '主机' as const,
      },
      {
        label: `scp ./file ${username}@${host}:~/`,
        insertText: `scp ./file ${username}@${host}:~/`,
        detail: `复制文件到 ${alias}`,
        source: '主机' as const,
      },
    ]
  })
}

export const collectSnippetCompletionSuggestions = ({
  prefix,
  snippetItems,
  hostItems,
  selectedHostId = '',
  limit = 8,
}: CollectSnippetCompletionParams): SnippetCompletionItem[] => {
  const normalizedPrefix = normalizeKeyword(prefix)
  if (!normalizedPrefix || normalizedPrefix.startsWith('#')) return []

  const history = collectHistorySuggestions(snippetItems)
  const host = collectHostSuggestions(hostItems, selectedHostId)
  const merged = [...history, ...host, ...BASE_COMMAND_TEMPLATES]
  const deduped = new Map<string, Omit<SnippetCompletionItem, 'key' | 'score'>>()
  for (const item of merged) {
    if (!deduped.has(item.insertText)) deduped.set(item.insertText, item)
  }

  return Array.from(deduped.values())
    .map((item) => ({
      ...item,
      key: `${item.source}:${item.insertText}`,
      score: scoreCompletion(normalizedPrefix, item.insertText, item.source),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
}

export const applySnippetCompletionText = (text: string, cursor: number, insertText: string) => {
  const safeText = String(text || '')
  const safeInsertText = String(insertText || '')
  const { lineStart, indent } = getCurrentLinePrefix(safeText, cursor)
  const before = safeText.slice(0, lineStart)
  const after = safeText.slice(cursor)
  const nextLine = `${indent}${safeInsertText.trimStart()}`
  const nextText = `${before}${nextLine}${after}`
  const nextCursor = before.length + nextLine.length
  return {
    text: nextText,
    cursor: nextCursor,
  }
}

export function useSnippetCommandCompletion(params: UseSnippetCommandCompletionParams) {
  const { model, snippetItems, hostItems, selectedHostId } = params

  const commandInputEl = ref<HTMLTextAreaElement | null>(null)
  const completionItems = ref<SnippetCompletionItem[]>([])
  const completionVisible = ref(false)
  const activeCompletionIndex = ref(0)

  const activeCompletion = computed(() => completionItems.value[activeCompletionIndex.value] || null)

  const closeCompletions = () => {
    completionVisible.value = false
    completionItems.value = []
    activeCompletionIndex.value = 0
  }

  const refreshCompletions = () => {
    const el = commandInputEl.value
    if (!el) {
      closeCompletions()
      return
    }
    if (el.selectionStart !== el.selectionEnd) {
      closeCompletions()
      return
    }
    const { content } = getCurrentLinePrefix(model.value, el.selectionStart || 0)
    const suggestions = collectSnippetCompletionSuggestions({
      prefix: content,
      snippetItems: snippetItems.value,
      hostItems: hostItems.value,
      selectedHostId: selectedHostId.value,
    })
    completionItems.value = suggestions
    completionVisible.value = suggestions.length > 0
    activeCompletionIndex.value = suggestions.length > 0 ? 0 : 0
  }

  const moveActiveCompletion = (offset: number) => {
    if (!completionVisible.value || completionItems.value.length === 0) return
    const total = completionItems.value.length
    activeCompletionIndex.value = (activeCompletionIndex.value + offset + total) % total
  }

  const applyCompletion = async (item = activeCompletion.value) => {
    const el = commandInputEl.value
    if (!el || !item) return
    const selectionStart = el.selectionStart || 0
    const next = applySnippetCompletionText(model.value, selectionStart, item.insertText)
    model.value = next.text
    await nextTick()
    commandInputEl.value?.focus()
    commandInputEl.value?.setSelectionRange(next.cursor, next.cursor)
    refreshCompletions()
  }

  const handleCommandEditorKeydown = async (event: KeyboardEvent) => {
    if (!completionVisible.value || completionItems.value.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveCompletion(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveCompletion(-1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCompletions()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      await applyCompletion()
    }
  }

  const handleCommandEditorInput = () => {
    refreshCompletions()
  }

  const handleCommandEditorBlur = () => {
    window.setTimeout(() => closeCompletions(), 120)
  }

  watch(model, () => {
    if (completionVisible.value) refreshCompletions()
  })

  return {
    commandInputEl,
    completionItems,
    completionVisible,
    activeCompletion,
    activeCompletionIndex,
    refreshCompletions,
    closeCompletions,
    applyCompletion,
    handleCommandEditorKeydown,
    handleCommandEditorInput,
    handleCommandEditorBlur,
  }
}
