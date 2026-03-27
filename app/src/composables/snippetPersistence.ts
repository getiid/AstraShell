import type { Ref } from 'vue'
import { buildDefaultDockerSnippet, normalizeReminderDate } from './snippetHelpers'
import type { LegacyQuickToolItem, SnippetItem } from './snippetTypes'

type CreateSnippetPersistenceParams = {
  defaultCategory: string
  legacyStorageKey: string
  snippetItems: Ref<SnippetItem[]>
  snippetExtraCategories: Ref<string[]>
  snippetStatus: Ref<string>
  snippetsLoaded: Ref<boolean>
}

const readLegacySnippets = (legacyStorageKey: string) => {
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

const readLegacyQuickTools = async (defaultCategory: string) => {
  try {
    const res = await window.lightterm.quicktoolsGetState()
    const parsed = Array.isArray(res.items) ? res.items : []
    const items = parsed
      .map((item: any) => ({
        id: String(item?.id || ''),
        category: String(item?.category || defaultCategory).trim() || defaultCategory,
        label: String(item?.label || '').trim(),
        cmd: String(item?.cmd || '').trim(),
        updatedAt: Number(item?.updatedAt || 0),
      }))
      .filter((item: LegacyQuickToolItem) => item.label && item.cmd)
    const extraCategories = [...new Set(items.map((item) => item.category).filter(Boolean))]
    return { items, extraCategories }
  } catch {
    return { items: [], extraCategories: [] }
  }
}

const normalizeQuickToolsAsSnippets = (items: LegacyQuickToolItem[], defaultCategory: string) => items.map((item, index) => {
  const now = Number(item.updatedAt || Date.now() + index)
  return {
    id: `snippet-${String(item.id || `quick-${index}`).replace(/[^a-zA-Z0-9_-]/g, '')}`,
    name: item.label,
    category: item.category || defaultCategory,
    hostId: '',
    description: '由快捷工具迁移',
    commands: item.cmd,
    reminderDate: '',
    lastRunAt: 0,
    lastRunStatus: 'idle' as const,
    lastRunOutput: '',
    createdAt: now,
    updatedAt: now,
  }
})

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

export function createSnippetPersistence(params: CreateSnippetPersistenceParams) {
  const {
    defaultCategory,
    legacyStorageKey,
    snippetItems,
    snippetExtraCategories,
    snippetStatus,
    snippetsLoaded,
  } = params

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
      reminderDate: normalizeReminderDate(String(item?.reminderDate || '')),
      lastRunAt: Number(item?.lastRunAt || 0),
      lastRunStatus: String(item?.lastRunStatus || 'idle'),
      lastRunOutput: String(item?.lastRunOutput || ''),
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
        applySnippetState([buildDefaultDockerSnippet(defaultCategory)], [])
        await saveSnippetState()
        return
      }

      const remoteItems = Array.isArray(res.items) ? (res.items as SnippetItem[]) : []
      const remoteCategories = Array.isArray(res.extraCategories) ? res.extraCategories : []
      const legacy = readLegacySnippets(legacyStorageKey)
      const legacyQuickTools = await readLegacyQuickTools(defaultCategory)
      const migratedQuickSnippets = normalizeQuickToolsAsSnippets(legacyQuickTools.items, defaultCategory)
      let mergedChanged = false
      let merged = {
        items: remoteItems,
        extraCategories: remoteCategories,
        changed: false,
      }
      if (legacy && (legacy.items.length > 0 || legacy.extraCategories.length > 0)) {
        merged = mergeSnippetSources(merged.items, merged.extraCategories, legacy.items, legacy.extraCategories)
        mergedChanged = mergedChanged || merged.changed
      }
      if (migratedQuickSnippets.length > 0 || legacyQuickTools.extraCategories.length > 0) {
        merged = mergeSnippetSources(merged.items, merged.extraCategories, migratedQuickSnippets, legacyQuickTools.extraCategories)
        mergedChanged = mergedChanged || merged.changed
      }
      if ((legacy && (legacy.items.length > 0 || legacy.extraCategories.length > 0)) || migratedQuickSnippets.length > 0) {
        applySnippetState(merged.items, merged.extraCategories)
        if (mergedChanged || remoteItems.length === 0 || migratedQuickSnippets.length > 0) {
          await saveSnippetState(merged.items, merged.extraCategories)
          if (migratedQuickSnippets.length > 0) {
            snippetStatus.value = '已将快捷工具迁移到代码片段'
            try { await window.lightterm.quicktoolsSetState({ items: [] }) } catch {}
          } else {
            snippetStatus.value = remoteItems.length > 0 || remoteCategories.length > 0
              ? '已合并本机旧版代码片段到共享数据库'
              : '已迁移本机旧版代码片段到共享数据库'
          }
        }
        try { localStorage.removeItem(legacyStorageKey) } catch {}
        return
      }

      if (remoteItems.length > 0 || remoteCategories.length > 0) {
        applySnippetState(remoteItems, remoteCategories)
        return
      }

      applySnippetState([buildDefaultDockerSnippet(defaultCategory)], [])
      await saveSnippetState()
    } finally {
      snippetsLoaded.value = true
    }
  }

  return {
    applySnippetState,
    saveSnippetState,
    restoreSnippets,
  }
}
