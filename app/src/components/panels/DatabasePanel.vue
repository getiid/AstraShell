<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Eye, EyeOff, FilePenLine, Menu, Play, Plus, ServerCrash, Table2, Trash2 } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()

const ENGINE_OPTIONS = ['MySQL', 'MariaDB', 'PostgreSQL', 'SQL Server']
const ENGINE_DEFAULT_PORT: Record<string, number> = {
  MySQL: 3306,
  MariaDB: 3306,
  PostgreSQL: 5432,
  'SQL Server': 1433,
}

const snippetMenuOpen = ref(false)
const visualCollapsed = ref(false)
const editorVisible = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorSaving = ref(false)
const editorError = ref('')
const passwordVisible = ref(false)
const editorForm = ref({
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
  editorForm.value = {
    id: '',
    name: '',
    engine: 'MySQL',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: '',
    database: '',
    note: '',
  }
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

const selected = computed(() => vm.selectedDatabase.value)

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
</script>

<template>
  <section class="panel database-panel">
    <div class="serial-head">
      <div>
        <h3>数据库连接</h3>
        <p class="hosts-header-sub">统一管理 MySQL、MariaDB、PostgreSQL 和 SQL Server 连接、查表与 SQL 查询</p>
      </div>
      <div class="database-header-menu-wrap">
        <button class="ghost database-header-menu-btn" @click.stop="visualCollapsed = !visualCollapsed">
          <Menu :size="16" />
        </button>
      </div>
    </div>

    <div class="database-status-bar">
      <div class="database-server-bar">
        <span class="database-server-label">数据库服务器</span>
        <select :value="vm.selectedDatabaseId.value" @change="handleServerChange">
          <option value="" disabled>选择服务器连接</option>
          <option v-for="item in vm.databaseItems.value" :key="item.id" :value="item.id">
            {{ item.name }} ｜ {{ item.engine }} ｜ {{ item.host }}:{{ item.port }}
          </option>
        </select>
        <button class="ghost tiny" :disabled="!selected" @click="selected && vm.connectDatabaseConnection(selected.id)">连接服务器</button>
        <button class="ghost tiny" :disabled="!selected || selected.state !== 'connected'" @click="selected && vm.disconnectDatabaseConnection(selected.id)">断开</button>
        <button class="ghost tiny" @click="openCreateEditor">
          <Plus :size="14" /> 新建服务器
        </button>
        <button class="ghost tiny" :disabled="!selected" @click="selected && openEditEditor(selected.id)">
          <FilePenLine :size="14" /> 修改服务器
        </button>
        <button class="ghost tiny danger-lite" :disabled="!selected" @click="selected && vm.deleteDatabaseConnection(selected.id)">
          <Trash2 :size="14" /> 删除服务器
        </button>
      </div>
    </div>

    <div class="database-layout">
      <aside class="database-sidebar">
        <div class="database-sidebar-head">
          <div class="database-search">
            <input v-model="vm.databaseKeyword.value" placeholder="搜索当前服务器上的数据库" />
          </div>
        </div>
        <div class="database-connection-list">
          <button
            v-for="item in vm.filteredDatabaseCatalogs.value"
            :key="item"
            class="database-connection-card"
            :class="{ active: selected?.database === item }"
            @click="handleDatabaseSelect(item)"
          >
            <div class="database-connection-head">
              <strong>{{ item }}</strong>
              <span class="status-pill plain">数据库</span>
            </div>
            <div class="database-connection-meta">{{ selected?.engine || '--' }} ｜ {{ selected?.host || '--' }}:{{ selected?.port || '--' }}</div>
            <div class="database-connection-user">{{ selected?.username || '--' }}</div>
          </button>
          <div v-if="selected?.state !== 'connected'" class="file-row empty">先在上方连接数据库服务器，再加载数据库清单</div>
          <div v-else-if="vm.filteredDatabaseCatalogs.value.length === 0" class="file-row empty">当前服务器没有可选数据库，或请先刷新连接</div>
        </div>
      </aside>

      <main class="database-workspace">
        <div v-if="selected" class="database-query-shell" :class="{ 'visual-collapsed': visualCollapsed }">
          <section class="database-query-editor">
            <div class="database-query-head">
              <strong>查询命令</strong>
              <div class="serial-head-actions database-query-actions">
                <div class="database-snippet-picker">
                  <button class="ghost tiny" @click.stop="toggleSnippetMenu">代码片段</button>
                  <div v-if="snippetMenuOpen" class="database-snippet-menu" @click.stop>
                    <button
                      v-for="item in vm.databaseSnippetItems.value"
                      :key="item.id"
                      class="database-snippet-item"
                      @click.stop="insertSnippet(item.id)"
                    >
                      <strong>{{ item.name }}</strong>
                      <span>{{ item.commands.split('\n')[0] }}</span>
                    </button>
                    <div v-if="vm.databaseSnippetItems.value.length === 0" class="database-snippet-empty">暂无数据库代码片段</div>
                  </div>
                </div>
                <button class="muted tiny" @click="vm.executeDatabaseQuery">
                  <Play :size="14" /> 执行
                </button>
              </div>
            </div>
            <textarea
              v-model="vm.databaseQuery.value"
              class="database-query-input"
              spellcheck="false"
              wrap="off"
              placeholder="输入 SQL 查询命令，例如 SHOW DATABASES; 或 SELECT * FROM orders LIMIT 20;"
            ></textarea>
          </section>

          <section class="database-query-result">
            <div class="database-query-head">
              <div>
                <strong>查询结果</strong>
                <span class="hosts-stat">{{ vm.queryResultSummary.value }}</span>
              </div>
              <div class="database-query-head-actions">
                <button class="ghost tiny" :disabled="vm.queryResultColumns.value.length === 0" @click="vm.exportDatabaseQueryResult">
                  导出 Excel
                </button>
                <span class="status-pill" :class="vm.databaseStateClass(selected.state)">{{ vm.databaseStateLabel(selected.state) }}</span>
              </div>
            </div>
            <div class="database-result-table-wrap">
              <table class="database-result-table">
                <thead>
                  <tr>
                    <th v-for="col in vm.queryResultColumns.value" :key="col">{{ col }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in vm.queryResultRows.value" :key="`row-${idx}`">
                    <td v-for="col in vm.queryResultColumns.value" :key="`${idx}-${col}`">{{ row[col] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <aside v-if="!visualCollapsed" class="database-visual-panel" @click.stop>
              <div class="database-visual-head">
                <strong>{{ selected.name }}</strong>
                <div class="database-visual-head-actions">
                  <span class="status-pill" :class="vm.databaseStateClass(selected.state)">{{ vm.databaseStateLabel(selected.state) }}</span>
                </div>
              </div>

              <div class="database-visual-meta">
                <span class="status-pill plain">{{ formatDatabaseVersion(selected) }}</span>
                <span class="status-pill plain">主机 {{ selected.host }}:{{ selected.port }}</span>
                <span class="status-pill plain">延迟 {{ selected.latency }}</span>
                <span class="status-pill plain">当前数据库 {{ selected.database || '未选择' }}</span>
              </div>

              <section class="database-visual-block grow">
                <div class="database-visual-block-head">
                  <Table2 :size="14" />
                  <strong>表清单</strong>
                </div>
                <div class="database-table-head">
                  <span>表名</span>
                  <span>更新时间</span>
                  <span>行数 / 大小</span>
                </div>
                <div class="database-table-list">
                  <article v-for="table in selected.tables" :key="table.name" class="database-table-item">
                    <div class="database-table-main">
                      <button class="database-table-name-btn" @click.stop="vm.previewDatabaseTable(table.name)">
                        {{ table.name }}
                      </button>
                    </div>
                    <div class="database-table-updated">
                      <span>{{ table.updatedAt }}</span>
                    </div>
                    <div class="database-table-metrics">
                      <span>{{ table.rows.toLocaleString() }} 行</span>
                      <span>{{ table.size }}</span>
                    </div>
                  </article>
                </div>
              </section>
          </aside>
        </div>

        <div v-else class="database-empty">
          <ServerCrash :size="18" />
          <span>请选择左侧一个数据库连接开始查看和查询。</span>
        </div>
      </main>
    </div>

    <div v-if="editorVisible" class="database-editor-overlay" @click.self="closeEditor">
      <section class="database-editor-panel">
        <div class="editor-title">
          <div class="editor-title-main">
            <strong>{{ editorMode === 'create' ? '新建数据库连接' : '编辑数据库连接' }}</strong>
            <small>填写连接参数后保存，后续可直接在左侧连接、断开、查表和执行 SQL。</small>
          </div>
          <div class="editor-title-actions">
            <button class="ghost tiny" :disabled="editorSaving" @click="closeEditor">关闭</button>
          </div>
        </div>

        <div class="database-editor-form">
          <label class="field">
            <span>连接名称</span>
            <input v-model.trim="editorForm.name" placeholder="例如：订单主库" />
          </label>
          <label class="field">
            <span>数据库类型</span>
            <select v-model="editorForm.engine" @change="handleEngineChange">
              <option v-for="engine in ENGINE_OPTIONS" :key="engine" :value="engine">{{ engine }}</option>
            </select>
          </label>
          <label class="field">
            <span>主机地址</span>
            <input v-model.trim="editorForm.host" placeholder="127.0.0.1" />
          </label>
          <label class="field">
            <span>端口</span>
            <input v-model.number="editorForm.port" type="number" min="1" placeholder="3306" />
          </label>
          <label class="field">
            <span>用户名</span>
            <input v-model.trim="editorForm.username" placeholder="root / postgres / sa" />
          </label>
          <label class="field">
            <span>密码</span>
            <div class="password-field">
              <input v-model="editorForm.password" :type="passwordVisible ? 'text' : 'password'" placeholder="可留空" />
              <button
                class="icon-btn password-toggle"
                type="button"
                :title="passwordVisible ? '隐藏密码' : '显示密码'"
                @click="passwordVisible = !passwordVisible"
              >
                <EyeOff v-if="passwordVisible" :size="14" />
                <Eye v-else :size="14" />
              </button>
            </div>
          </label>
          <label class="field">
            <span>默认数据库 / Schema</span>
            <input v-model.trim="editorForm.database" placeholder="可留空" />
          </label>
          <label class="field span-2">
            <span>备注</span>
            <textarea v-model.trim="editorForm.note" rows="3" placeholder="例如：生产只读、报表环境、测试联调"></textarea>
          </label>
        </div>
        <div v-if="editorError" class="database-editor-error">{{ editorError }}</div>

        <div class="database-editor-actions">
          <button class="ghost tiny" :disabled="editorSaving" @click="closeEditor">取消</button>
          <button class="muted tiny" :disabled="editorSaving" @click="submitEditor">
            {{ editorSaving ? '保存中...' : '保存' }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
