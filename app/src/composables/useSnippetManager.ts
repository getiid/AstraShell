import { computed, ref, watch } from 'vue'
import { createSnippetExecution } from './snippetExecution'
import { createSnippetManagerCategories } from './snippetManagerCategories'
import { createSnippetManagerEditor } from './snippetManagerEditor'
import {
  createEmptySnippet,
  filterSnippetItems,
  formatSnippetRunTime,
  snippetCommandLines,
  snippetLastRunLabel,
  snippetLastRunTone,
  snippetLineCount,
  snippetListRunLabel,
  snippetReminderDate,
  snippetReminderDays,
  snippetReminderLabel,
  snippetReminderTone,
} from './snippetHelpers'
import type { UseSnippetManagerParams } from './snippetManagerTypes'
import { createSnippetPersistence } from './snippetPersistence'
import type { SnippetItem } from './snippetTypes'

export type { SnippetItem } from './snippetTypes'

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
    recordLocalInput,
    useHost,
    connectSSH,
    focusTerminal,
    defaultCategory = DEFAULT_SNIPPET_CATEGORY,
    allCategory = ALL_SNIPPET_CATEGORY,
    legacyStorageKey = LEGACY_STORAGE_KEY,
  } = params

  const snippetItems = ref<SnippetItem[]>([])
  const snippetsLoaded = ref(false)
  const snippetKeyword = ref('')
  const snippetCategory = ref(allCategory)
  const localSnippetCategory = ref(allCategory)
  const localSnippetKeyword = ref('')
  const terminalSnippetCategory = ref(allCategory)
  const snippetStatus = ref('')
  const snippetRunDelayMs = ref(1200)
  const snippetRunning = ref(false)
  const snippetStopRequested = ref(false)
  const selectedSnippetId = ref('')
  const snippetEditorVisible = ref(true)
  const snippetEdit = ref<SnippetItem>(createEmptySnippet(defaultCategory))
  const snippetExtraCategories = ref<string[]>([])
  const newSnippetCategoryName = ref('')
  const newSnippetCategoryInputVisible = ref(false)
  const editingSnippetCategory = ref('')
  const editingSnippetCategoryName = ref('')
  const terminalSnippetId = ref('')

  const filteredSnippetItems = computed(() => (
    filterSnippetItems(
      snippetItems.value,
      snippetCategory.value,
      allCategory,
      snippetKeyword.value,
    )
  ))

  const filteredLocalSnippetItems = computed(() => (
    filterSnippetItems(
      snippetItems.value,
      localSnippetCategory.value,
      allCategory,
      localSnippetKeyword.value,
    )
  ))

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
    return [...snippetItems.value]
      .filter((item) => terminalSnippetCategory.value === allCategory || item.category === terminalSnippetCategory.value)
      .sort((a, b) => {
        const aMatched = !!currentHostId && a.hostId === currentHostId
        const bMatched = !!currentHostId && b.hostId === currentHostId
        if (aMatched !== bMatched) return aMatched ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
  })

  const { saveSnippetState, restoreSnippets } = createSnippetPersistence({
    defaultCategory,
    legacyStorageKey,
    snippetItems,
    snippetExtraCategories,
    snippetStatus,
    snippetsLoaded,
  })
  const categories = createSnippetManagerCategories({
    defaultCategory,
    allCategory,
    state: {
      snippetItems,
      snippetCategory,
      localSnippetCategory,
      terminalSnippetCategory,
      snippetEdit,
      snippetExtraCategories,
      newSnippetCategoryName,
      newSnippetCategoryInputVisible,
      editingSnippetCategory,
      editingSnippetCategoryName,
      snippetStatus,
    },
    saveSnippetState,
  })
  const editor = createSnippetManagerEditor({
    defaultCategory,
    selectedSnippetId,
    snippetEdit,
    snippetItems,
    snippetEditorVisible,
    snippetStatus,
    saveSnippetState,
    resolveDraftCategory: categories.resolveDraftCategory,
  })

  const {
    executeSnippetTask,
    runSnippet,
    stopSnippet,
    getTerminalSnippet,
    runTerminalSnippet,
    executeSnippetOnLocalTerminal,
    sendSnippetRawToTerminal,
  } = createSnippetExecution({
    hostItems,
    sshForm,
    sshConnected,
    sshSessionId,
    activeTerminalMode,
    serialConnected,
    serialCurrentPath,
    localConnected,
    activeLocalSessionId,
    recordLocalInput,
    useHost,
    connectSSH,
    focusTerminal,
    snippetItems,
    snippetEdit,
    selectedSnippetId,
    terminalSnippetId,
    terminalSnippetItems,
    snippetStatus,
    snippetRunDelayMs,
    snippetRunning,
    snippetStopRequested,
    saveSnippetState,
  })

  const snippetHostLabel = (hostId: string) => {
    if (!hostId) return '当前 SSH 会话'
    const host = hostItems.value.find((item) => item.id === hostId)
    return host ? `${host.name} (${host.host})` : '未找到主机'
  }

  watch(snippetItems, (items) => {
    if (!items.some((item) => item.id === terminalSnippetId.value)) {
      terminalSnippetId.value = items[0]?.id || ''
    }
  }, { immediate: true })

  watch(terminalSnippetItems, (items) => {
    if (!items.some((item) => item.id === terminalSnippetId.value)) {
      terminalSnippetId.value = items[0]?.id || ''
    }
  }, { immediate: true })

  watch(categories.snippetCategories, () => {
    categories.ensureValidCategorySelection()
  }, { immediate: true })

  return {
    snippetItems,
    snippetsLoaded,
    snippetKeyword,
    snippetCategory,
    localSnippetCategory,
    localSnippetKeyword,
    terminalSnippetCategory,
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
    editingSnippetCategory,
    editingSnippetCategoryName,
    terminalSnippetId,
    snippetCategories: categories.snippetCategories,
    displaySnippetCategories: categories.displaySnippetCategories,
    filteredSnippetItems,
    localSnippetCategories: categories.localSnippetCategories,
    filteredLocalSnippetItems,
    terminalSnippetCategories: categories.terminalSnippetCategories,
    currentSessionHostId,
    terminalSnippetItems,
    createEmptySnippet: () => createEmptySnippet(defaultCategory),
    restoreSnippets,
    openSnippetEditor: editor.openSnippetEditor,
    clearSnippetEditor: editor.clearSnippetEditor,
    beginAddSnippetCategory: categories.beginAddSnippetCategory,
    addSnippetCategory: categories.addSnippetCategory,
    beginRenameSnippetCategory: categories.beginRenameSnippetCategory,
    cancelRenameSnippetCategory: categories.cancelRenameSnippetCategory,
    renameSnippetCategory: categories.renameSnippetCategory,
    deleteSnippetCategory: categories.deleteSnippetCategory,
    saveSnippet: editor.saveSnippet,
    deleteSnippet: editor.deleteSnippet,
    executeSnippetTask,
    snippetCommandLines,
    snippetLineCount,
    runSnippet,
    stopSnippet,
    snippetHostLabel,
    formatSnippetRunTime,
    snippetLastRunLabel,
    snippetListRunLabel,
    snippetLastRunTone,
    snippetReminderDate,
    snippetReminderDays,
    snippetReminderLabel,
    snippetReminderTone,
    getTerminalSnippet,
    runTerminalSnippet,
    executeSnippetOnLocalTerminal,
    sendSnippetRawToTerminal,
  }
}
