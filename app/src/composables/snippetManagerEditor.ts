import { createEmptySnippet, normalizeReminderDate } from './snippetHelpers'
import type { SnippetItem } from './snippetTypes'

export function createSnippetManagerEditor(params: {
  defaultCategory: string
  selectedSnippetId: { value: string }
  snippetEdit: { value: SnippetItem }
  snippetItems: { value: SnippetItem[] }
  snippetEditorVisible: { value: boolean }
  snippetStatus: { value: string }
  saveSnippetState: () => Promise<boolean>
  resolveDraftCategory: () => string
}) {
  const {
    defaultCategory,
    selectedSnippetId,
    snippetEdit,
    snippetItems,
    snippetEditorVisible,
    snippetStatus,
    saveSnippetState,
    resolveDraftCategory,
  } = params

  const openSnippetEditor = (item: SnippetItem) => {
    selectedSnippetId.value = item.id
    snippetEdit.value = { ...item }
    snippetEditorVisible.value = true
  }

  const clearSnippetEditor = () => {
    selectedSnippetId.value = ''
    snippetEdit.value = {
      ...createEmptySnippet(defaultCategory),
      category: resolveDraftCategory(),
    }
    snippetEditorVisible.value = true
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
    const reminderDate = normalizeReminderDate(draft.reminderDate || '')
    if (draft.reminderDate && !reminderDate) {
      snippetStatus.value = '请填写有效的提醒日期'
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
      reminderDate,
      lastRunAt: Number(draft.lastRunAt || 0),
      lastRunStatus: (draft.lastRunStatus || 'idle') as SnippetItem['lastRunStatus'],
      lastRunOutput: String(draft.lastRunOutput || ''),
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

  return {
    openSnippetEditor,
    clearSnippetEditor,
    saveSnippet,
    deleteSnippet,
  }
}
