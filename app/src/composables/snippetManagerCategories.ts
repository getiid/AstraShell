import { computed } from 'vue'
import type { SnippetCategoryState } from './snippetManagerTypes'

export function createSnippetManagerCategories(params: {
  defaultCategory: string
  allCategory: string
  state: SnippetCategoryState
  saveSnippetState: () => Promise<boolean>
}) {
  const {
    defaultCategory,
    allCategory,
    state,
    saveSnippetState,
  } = params

  const {
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
  } = state

  const snippetCategories = computed(() => {
    const set = new Set<string>([defaultCategory])
    snippetItems.value.forEach((item) => set.add(item.category || defaultCategory))
    snippetExtraCategories.value.forEach((category) => set.add(category))
    return Array.from(set)
  })

  const displaySnippetCategories = computed(() => [allCategory, ...snippetCategories.value])
  const localSnippetCategories = computed(() => [allCategory, ...snippetCategories.value])
  const terminalSnippetCategories = computed(() => [allCategory, ...snippetCategories.value])

  const resolveDraftCategory = () => (
    snippetCategory.value !== allCategory && snippetCategories.value.includes(snippetCategory.value)
      ? snippetCategory.value
      : defaultCategory
  )

  const ensureValidCategorySelection = () => {
    if (snippetCategory.value !== allCategory && !snippetCategories.value.includes(snippetCategory.value)) {
      snippetCategory.value = allCategory
    }
    if (localSnippetCategory.value !== allCategory && !snippetCategories.value.includes(localSnippetCategory.value)) {
      localSnippetCategory.value = allCategory
    }
    if (terminalSnippetCategory.value !== allCategory && !snippetCategories.value.includes(terminalSnippetCategory.value)) {
      terminalSnippetCategory.value = allCategory
    }
    if (snippetEdit.value.category && !snippetCategories.value.includes(snippetEdit.value.category)) {
      snippetEdit.value.category = defaultCategory
    }
  }

  const beginAddSnippetCategory = () => {
    editingSnippetCategory.value = ''
    editingSnippetCategoryName.value = ''
    newSnippetCategoryInputVisible.value = true
    newSnippetCategoryName.value = ''
  }

  const beginRenameSnippetCategory = (category: string) => {
    if (!category || category === defaultCategory || category === allCategory) return
    newSnippetCategoryInputVisible.value = false
    editingSnippetCategory.value = category
    editingSnippetCategoryName.value = category
  }

  const cancelRenameSnippetCategory = () => {
    editingSnippetCategory.value = ''
    editingSnippetCategoryName.value = ''
  }

  const addSnippetCategory = async () => {
    const name = newSnippetCategoryName.value.trim()
    if (!name) {
      newSnippetCategoryInputVisible.value = false
      return
    }
    if (name === defaultCategory || name === allCategory) {
      snippetStatus.value = `分类名不能使用「${name}」`
      return
    }
    if (!snippetCategories.value.includes(name) && !snippetExtraCategories.value.includes(name)) {
      snippetExtraCategories.value.push(name)
      await saveSnippetState()
    }
    snippetCategory.value = name
    snippetEdit.value.category = name
    newSnippetCategoryName.value = ''
    newSnippetCategoryInputVisible.value = false
  }

  const renameSnippetCategory = async (from = editingSnippetCategory.value) => {
    if (!from || from === defaultCategory || from === allCategory) return
    const to = editingSnippetCategory.value === from
      ? editingSnippetCategoryName.value.trim()
      : ''
    if (!to || to === from) {
      cancelRenameSnippetCategory()
      return
    }
    if (to === defaultCategory || to === allCategory) {
      snippetStatus.value = `分类名不能使用「${to}」`
      return
    }

    const now = Date.now()
    snippetExtraCategories.value = [...new Set(snippetExtraCategories.value.map((item) => (item === from ? to : item)).concat(to))]
    snippetItems.value = snippetItems.value.map((item) => (
      item.category === from ? { ...item, category: to, updatedAt: now } : item
    ))
    if (snippetCategory.value === from) snippetCategory.value = to
    if (snippetEdit.value.category === from) snippetEdit.value.category = to
    const ok = await saveSnippetState()
    if (!ok) return
    cancelRenameSnippetCategory()
    snippetStatus.value = `分类已重命名：${from} → ${to}`
  }

  const deleteSnippetCategory = async (category: string) => {
    if (!category || category === defaultCategory || category === allCategory) return
    const confirmed = window.confirm(`删除分类「${category}」后，相关片段会自动迁移到「${defaultCategory}」。是否继续？`)
    if (!confirmed) return

    const now = Date.now()
    snippetItems.value = snippetItems.value.map((item) => (
      item.category === category ? { ...item, category: defaultCategory, updatedAt: now } : item
    ))
    snippetExtraCategories.value = snippetExtraCategories.value.filter((item) => item !== category)
    if (snippetCategory.value === category) snippetCategory.value = defaultCategory
    if (snippetEdit.value.category === category) snippetEdit.value.category = defaultCategory
    cancelRenameSnippetCategory()
    const ok = await saveSnippetState()
    if (!ok) return
    snippetStatus.value = `分类已删除：${category}`
  }

  return {
    snippetCategories,
    displaySnippetCategories,
    localSnippetCategories,
    terminalSnippetCategories,
    resolveDraftCategory,
    ensureValidCategorySelection,
    beginAddSnippetCategory,
    beginRenameSnippetCategory,
    cancelRenameSnippetCategory,
    addSnippetCategory,
    renameSnippetCategory,
    deleteSnippetCategory,
  }
}
