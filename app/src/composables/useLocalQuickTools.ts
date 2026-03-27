import { computed, ref, type Ref } from 'vue'

export type LocalQuickItem = {
  id: string
  category: string
  label: string
  cmd: string
}

type UseLocalQuickToolsParams = {
  localStatus: Ref<string>
}

export function useLocalQuickTools(params: UseLocalQuickToolsParams) {
  const { localStatus } = params

  const defaultLocalQuickItems: LocalQuickItem[] = [
    { id: 'lq-sysinfo', category: '系统', label: '系统信息', cmd: 'uname -a' },
    { id: 'lq-disk', category: '系统', label: '磁盘占用', cmd: 'df -h' },
    { id: 'lq-list', category: '文件', label: '目录列表', cmd: 'ls -la' },
    { id: 'lq-proc', category: '系统', label: '进程快照', cmd: 'ps aux | head -n 20' },
  ]

  const localQuickItems = ref<LocalQuickItem[]>([...defaultLocalQuickItems])
  const localQuickCategory = ref('全部')
  const localQuickEditId = ref('')
  const localQuickEditorVisible = ref(false)
  const localQuickDraftCategory = ref('系统')
  const localQuickDraftLabel = ref('')
  const localQuickDraftCmd = ref('')

  const localQuickCategories = computed(() => {
    const set = new Set<string>(['全部'])
    localQuickItems.value.forEach((item) => set.add(item.category || '未分类'))
    return [...set]
  })

  const filteredLocalQuickItems = computed(() => {
    if (localQuickCategory.value === '全部') return localQuickItems.value
    return localQuickItems.value.filter((item) => item.category === localQuickCategory.value)
  })

  const saveLocalQuickItems = async () => {
    const items = localQuickItems.value.map((item) => ({ ...item, updatedAt: Date.now() }))
    const res = await window.lightterm.quicktoolsSetState({ items })
    if (res.ok && Array.isArray(res.items)) {
      localQuickItems.value = res.items as LocalQuickItem[]
    }
  }

  const restoreLocalQuickItems = async () => {
    const res = await window.lightterm.quicktoolsGetState()
    if (!res.ok) return
    const parsed = Array.isArray(res.items) ? res.items : []
    const normalized = parsed
      .map((item: any) => ({
        id: String(item?.id || `lq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        category: String(item?.category || '未分类').trim() || '未分类',
        label: String(item?.label || '').trim(),
        cmd: String(item?.cmd || '').trim(),
      }))
      .filter((item: LocalQuickItem) => item.label && item.cmd)
    localQuickItems.value = normalized.length > 0 ? normalized : [...defaultLocalQuickItems]
  }

  const startEditLocalQuickItem = (item: LocalQuickItem) => {
    localQuickEditId.value = item.id
    localQuickDraftCategory.value = item.category || '系统'
    localQuickDraftLabel.value = item.label
    localQuickDraftCmd.value = item.cmd
    localQuickEditorVisible.value = true
  }

  const resetLocalQuickDraft = () => {
    localQuickEditId.value = ''
    localQuickDraftCategory.value = localQuickCategory.value === '全部' ? '系统' : localQuickCategory.value
    localQuickDraftLabel.value = ''
    localQuickDraftCmd.value = ''
  }

  const openLocalQuickCreate = () => {
    resetLocalQuickDraft()
    localQuickEditorVisible.value = true
  }

  const closeLocalQuickEditor = () => {
    localQuickEditorVisible.value = false
  }

  const saveLocalQuickDraft = () => {
    const category = String(localQuickDraftCategory.value || '').trim() || '未分类'
    const label = String(localQuickDraftLabel.value || '').trim()
    const cmd = String(localQuickDraftCmd.value || '').trim()
    if (!label || !cmd) {
      localStatus.value = '快捷工具保存失败：名称和命令不能为空'
      return
    }

    if (localQuickEditId.value) {
      const row = localQuickItems.value.find((item) => item.id === localQuickEditId.value)
      if (row) {
        row.category = category
        row.label = label
        row.cmd = cmd
      }
    } else {
      localQuickItems.value.unshift({
        id: `lq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        category,
        label,
        cmd,
      })
    }
    void saveLocalQuickItems()
    resetLocalQuickDraft()
    localQuickEditorVisible.value = false
  }

  const removeLocalQuickItem = (id: string) => {
    localQuickItems.value = localQuickItems.value.filter((item) => item.id !== id)
    void saveLocalQuickItems()
    if (localQuickEditId.value === id) resetLocalQuickDraft()
  }

  return {
    defaultLocalQuickItems,
    localQuickItems,
    localQuickCategory,
    localQuickEditId,
    localQuickEditorVisible,
    localQuickDraftCategory,
    localQuickDraftLabel,
    localQuickDraftCmd,
    localQuickCategories,
    filteredLocalQuickItems,
    saveLocalQuickItems,
    restoreLocalQuickItems,
    startEditLocalQuickItem,
    resetLocalQuickDraft,
    openLocalQuickCreate,
    closeLocalQuickEditor,
    saveLocalQuickDraft,
    removeLocalQuickItem,
  }
}
