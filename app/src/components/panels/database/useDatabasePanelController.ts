import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const ENGINE_OPTIONS = ['MySQL', 'MariaDB', 'PostgreSQL', 'SQL Server']
const ENGINE_DEFAULT_PORT: Record<string, number> = {
  MySQL: 3306,
  MariaDB: 3306,
  PostgreSQL: 5432,
  'SQL Server': 1433,
}

const createDefaultEditorForm = () => ({
  id: '',
  name: '',
  engine: 'MySQL',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: '',
  database: '',
  note: '',
})

export const useDatabasePanelController = (vm: any) => {
  const snippetMenuOpen = ref(false)
  const visualCollapsed = ref(false)
  const editorVisible = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorSaving = ref(false)
  const editorError = ref('')
  const passwordVisible = ref(false)
  const editorForm = ref(createDefaultEditorForm())

  const selected = computed(() => vm.selectedDatabase.value)

  const closeSnippetMenu = () => {
    snippetMenuOpen.value = false
  }

  const toggleSnippetMenu = () => {
    snippetMenuOpen.value = !snippetMenuOpen.value
  }

  const insertSnippet = (id: string) => {
    vm.insertDatabaseSnippet(id)
    closeSnippetMenu()
  }

  const resetEditorForm = () => {
    editorForm.value = createDefaultEditorForm()
    editorError.value = ''
    passwordVisible.value = false
  }

  const openCreateEditor = () => {
    editorMode.value = 'create'
    resetEditorForm()
    editorVisible.value = true
  }

  const openEditEditor = (id?: string) => {
    const target = vm.databaseItems.value.find((item: any) => item.id === (id || vm.selectedDatabaseId.value))
    if (!target) return
    editorMode.value = 'edit'
    editorForm.value = {
      id: target.id,
      name: target.name,
      engine: target.engine,
      host: target.host,
      port: Number(target.port || 3306),
      username: target.username,
      password: target.password || '',
      database: target.database || '',
      note: target.note || '',
    }
    editorError.value = ''
    passwordVisible.value = false
    editorVisible.value = true
  }

  const closeEditor = () => {
    if (editorSaving.value) return
    editorVisible.value = false
    editorError.value = ''
  }

  const handleEngineChange = () => {
    const nextPort = ENGINE_DEFAULT_PORT[editorForm.value.engine] || 3306
    if (!editorForm.value.port || Object.values(ENGINE_DEFAULT_PORT).includes(Number(editorForm.value.port))) {
      editorForm.value.port = nextPort
    }
    if (!editorForm.value.username) {
      if (editorForm.value.engine === 'PostgreSQL') editorForm.value.username = 'postgres'
      else if (editorForm.value.engine === 'SQL Server') editorForm.value.username = 'sa'
      else editorForm.value.username = 'root'
    }
  }

  const submitEditor = async () => {
    if (editorSaving.value) return
    editorSaving.value = true
    editorError.value = ''
    const payload = {
      id: editorForm.value.id || undefined,
      name: editorForm.value.name,
      engine: editorForm.value.engine,
      host: editorForm.value.host,
      port: Number(editorForm.value.port || 0),
      username: editorForm.value.username,
      password: editorForm.value.password,
      database: editorForm.value.database,
      note: editorForm.value.note,
    }
    const result = editorMode.value === 'create'
      ? await vm.createDatabaseConnection(payload)
      : await vm.editDatabaseConnection(editorForm.value.id, payload)
    editorSaving.value = false
    if (!result?.ok) {
      const message = result?.error || '保存失败'
      editorError.value = message
      vm.databaseStatus.value = message
      return
    }
    passwordVisible.value = false
    editorVisible.value = false
  }

  const formatDatabaseVersion = (item: any) => {
    const engine = String(item?.engine || '').trim()
    const version = String(item?.version || '').replace(/\s+/g, ' ').trim()
    if (!version) return engine || '--'
    if (engine === 'SQL Server') {
      const matched = version.match(/Microsoft SQL Server\s+\d{4}(?:\s+R\d)?/i)
      return matched?.[0] || 'Microsoft SQL Server'
    }
    return `${engine} ${version}`.trim()
  }

  const handleServerChange = async (event: Event) => {
    const nextId = (event.target as HTMLSelectElement | null)?.value || ''
    if (!nextId) return
    vm.selectDatabaseConnection(nextId)
    const current = vm.databaseItems.value.find((item: any) => item.id === nextId) || vm.selectedDatabase.value
    if (current?.state === 'connected') {
      await vm.loadDatabaseCatalogs(current.id)
    }
  }

  const handleDatabaseSelect = async (databaseName: string) => {
    if (!databaseName) return
    await vm.selectDatabaseCatalog(databaseName)
  }

  onMounted(() => {
    window.addEventListener('click', closeSnippetMenu)
    window.addEventListener('resize', closeSnippetMenu)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('click', closeSnippetMenu)
    window.removeEventListener('resize', closeSnippetMenu)
  })

  return {
    ENGINE_OPTIONS,
    snippetMenuOpen,
    visualCollapsed,
    editorVisible,
    editorMode,
    editorSaving,
    editorError,
    passwordVisible,
    editorForm,
    selected,
    toggleSnippetMenu,
    insertSnippet,
    openCreateEditor,
    openEditEditor,
    closeEditor,
    handleEngineChange,
    submitEditor,
    formatDatabaseVersion,
    handleServerChange,
    handleDatabaseSelect,
  }
}
