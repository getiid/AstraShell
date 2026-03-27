import { computed, onMounted, ref } from 'vue'
import { createDatabaseWorkspaceActions } from './databaseWorkspaceActions'
import {
  databaseStateClass,
  databaseStateLabel,
  filterDatabaseSnippetItems,
} from './databaseWorkspaceHelpers'
import type {
  DatabaseConnection,
  DatabaseSnippetItem,
  QueryRow,
} from './databaseWorkspaceTypes'

type UseDatabaseWorkspaceParams = {
  openSnippetsPanel: () => void
  snippetItems: { value: DatabaseSnippetItem[] }
}

export function useDatabaseWorkspace(params: UseDatabaseWorkspaceParams) {
  const { openSnippetsPanel, snippetItems } = params

  const databaseItems = ref<DatabaseConnection[]>([])
  const selectedDatabaseId = ref('')
  const selectedDatabaseSnippetCategory = ref('')
  const databaseKeyword = ref('')
  const databaseStatus = ref('数据库工作台已就绪')
  const databaseQuery = ref('')
  const queryResultColumns = ref<string[]>([])
  const queryResultRows = ref<QueryRow[]>([])
  const queryResultSummary = ref('尚未执行查询')

  const bridgeAvailable = () => typeof window !== 'undefined' && !!window.lightterm?.dbListConnections

  const databaseSnippetItems = computed(() => filterDatabaseSnippetItems(snippetItems.value))

  const databaseSnippetCategories = computed(() => {
    return Array.from(new Set(
      databaseSnippetItems.value
        .map((item) => String(item.category || '').trim())
        .filter(Boolean),
    ))
  })

  const activeDatabaseSnippetCategory = computed(() => {
    if (databaseSnippetCategories.value.includes(selectedDatabaseSnippetCategory.value)) {
      return selectedDatabaseSnippetCategory.value
    }
    return databaseSnippetCategories.value[0] || ''
  })

  const currentDatabaseSnippetItems = computed(() => {
    const activeCategory = activeDatabaseSnippetCategory.value
    if (!activeCategory) return databaseSnippetItems.value
    return databaseSnippetItems.value.filter((item) => item.category === activeCategory)
  })

  const filteredDatabaseItems = computed(() => {
    const keyword = databaseKeyword.value.trim().toLowerCase()
    const rows = [...databaseItems.value]
    if (!keyword) return rows
    return rows.filter((item) => (
      [item.name, item.engine, item.host, item.database, item.username, item.note]
        .some((value) => String(value || '').toLowerCase().includes(keyword))
    ))
  })

  const selectedDatabase = computed(() => (
    databaseItems.value.find((item) => item.id === selectedDatabaseId.value)
    || filteredDatabaseItems.value[0]
    || null
  ))

  const filteredDatabaseCatalogs = computed(() => {
    const target = selectedDatabase.value
    const keyword = databaseKeyword.value.trim().toLowerCase()
    const rows = Array.isArray(target?.databases) ? [...target.databases] : []
    if (!keyword) return rows
    return rows.filter((item) => item.toLowerCase().includes(keyword))
  })

  const databaseMetrics = computed(() => {
    const total = databaseItems.value.length
    const online = databaseItems.value.filter((item) => item.state === 'connected').length
    const databases = selectedDatabase.value?.databases.length || 0
    const tables = selectedDatabase.value?.tables.length || 0
    const schemas = selectedDatabase.value?.schemas.length || 0
    return { total, online, databases, tables, schemas }
  })

  const {
    databaseContextActions,
    loadDatabaseConnections,
    selectDatabaseConnection,
    loadDatabaseCatalogs,
    connectDatabaseConnection,
    disconnectDatabaseConnection,
    selectDatabaseCatalog,
    createDatabaseConnection,
    editDatabaseConnection,
    deleteDatabaseConnection,
    importDatabaseConnection,
    exportDatabaseConnection,
    openDatabaseQuery,
    executeDatabaseQuery,
    exportDatabaseQueryResult,
    openDatabaseSnippets,
    insertDatabaseSnippet,
    previewDatabaseTable,
  } = createDatabaseWorkspaceActions({
    openSnippetsPanel,
    databaseItems,
    selectedDatabaseId,
    databaseStatus,
    databaseQuery,
    queryResultColumns,
    queryResultRows,
    queryResultSummary,
    selectedDatabase,
    databaseSnippetItems,
    bridgeAvailable,
  })

  const selectDatabaseSnippetCategory = (category: string) => {
    if (!databaseSnippetCategories.value.includes(category)) return
    selectedDatabaseSnippetCategory.value = category
  }

  onMounted(() => {
    void loadDatabaseConnections()
  })

  return {
    databaseItems,
    filteredDatabaseItems,
    filteredDatabaseCatalogs,
    selectedDatabaseId,
    selectedDatabase,
    databaseKeyword,
    databaseStatus,
    databaseQuery,
    queryResultColumns,
    queryResultRows,
    queryResultSummary,
    databaseMetrics,
    databaseSnippetItems,
    databaseSnippetCategories,
    activeDatabaseSnippetCategory,
    currentDatabaseSnippetItems,
    databaseContextActions,
    databaseStateLabel,
    databaseStateClass,
    selectDatabaseConnection,
    loadDatabaseCatalogs,
    connectDatabaseConnection,
    disconnectDatabaseConnection,
    selectDatabaseCatalog,
    importDatabaseConnection,
    exportDatabaseConnection,
    openDatabaseQuery,
    deleteDatabaseConnection,
    createDatabaseConnection,
    editDatabaseConnection,
    executeDatabaseQuery,
    exportDatabaseQueryResult,
    insertDatabaseSnippet,
    selectDatabaseSnippetCategory,
    previewDatabaseTable,
    openDatabaseSnippets,
    loadDatabaseConnections,
  }
}
