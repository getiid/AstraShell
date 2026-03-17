import { computed, ref, type Ref } from 'vue'

type NotifyFn = (ok: boolean, message: string) => void

export function useHostFilters(params: {
  hostItems: Ref<any[]>
  extraCategories: Ref<string[]>
  defaultCategory: string
  allCategory: string
  notify: NotifyFn
  refreshHosts: () => Promise<void>
}) {
  const { hostItems, extraCategories, defaultCategory, allCategory, notify, refreshHosts } = params

  const selectedCategory = ref(allCategory)
  const hostKeyword = ref('')
  const newCategoryName = ref('')
  const newCategoryInputVisible = ref(false)

  const hostCategories = computed(() => {
    const set = new Set<string>([defaultCategory])
    hostItems.value.forEach((h) => set.add(h.category || defaultCategory))
    extraCategories.value.forEach((c) => set.add(c))
    return Array.from(set)
  })

  const displayCategories = computed(() => [allCategory, ...hostCategories.value])

  const filteredHosts = computed(() => {
    const keyword = hostKeyword.value.trim().toLowerCase()
    return hostItems.value.filter((h) => {
      const categoryName = h.category || defaultCategory
      const inCategory = selectedCategory.value === allCategory || categoryName === selectedCategory.value
      if (!inCategory) return false
      if (!keyword) return true
      return [h.name, h.host, h.username, h.category].some((v) => String(v || '').toLowerCase().includes(keyword))
    })
  })

  const beginAddCategory = () => {
    newCategoryInputVisible.value = true
    newCategoryName.value = ''
  }

  const addCategory = () => {
    const name = newCategoryName.value.trim()
    if (!name) {
      newCategoryInputVisible.value = false
      return
    }
    if (!extraCategories.value.includes(name) && !hostCategories.value.includes(name)) {
      extraCategories.value.push(name)
    }
    selectedCategory.value = name
    newCategoryName.value = ''
    newCategoryInputVisible.value = false
    notify(true, `分类已新建：${name}`)
  }

  const renameCategoryInline = async (from: string) => {
    if (from === defaultCategory || from === allCategory) return
    const to = window.prompt('重命名分类', from)?.trim()
    if (!to || to === from) return

    extraCategories.value = extraCategories.value.map((c) => (c === from ? to : c))

    const targets = hostItems.value.filter((h) => (h.category || defaultCategory) === from)
    for (const h of targets) {
      await window.lightterm.hostsSave({
        id: h.id,
        name: h.name,
        host: h.host,
        port: h.port,
        username: h.username,
        password: h.password || '',
        category: to,
        authType: h.auth_type || 'password',
        privateKeyRef: h.private_key_ref || null,
      })
    }
    selectedCategory.value = to
    await refreshHosts()
    notify(true, `分类已重命名：${from} → ${to}`)
  }

  return {
    selectedCategory,
    hostKeyword,
    newCategoryName,
    newCategoryInputVisible,
    hostCategories,
    displayCategories,
    filteredHosts,
    beginAddCategory,
    addCategory,
    renameCategoryInline,
  }
}
