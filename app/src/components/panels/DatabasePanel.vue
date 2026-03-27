<script setup lang="ts">
import { toRaw } from 'vue'
import { FilePenLine, Menu, Play, Plus, ServerCrash, Trash2 } from 'lucide-vue-next'
import DatabaseConnectionEditor from './database/DatabaseConnectionEditor.vue'
import DatabaseSnippetPicker from './database/DatabaseSnippetPicker.vue'
import DatabaseVisualPanel from './database/DatabaseVisualPanel.vue'
import { useDatabasePanelController } from './database/useDatabasePanelController'

const { vm } = defineProps<{ vm: any }>()
const rawVm = toRaw(vm)

const {
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
} = useDatabasePanelController(vm)
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
                  <DatabaseSnippetPicker
                    :vm="rawVm"
                    :snippet-menu-open="snippetMenuOpen"
                    :toggle-snippet-menu="toggleSnippetMenu"
                    :insert-snippet="insertSnippet"
                  />
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

          <DatabaseVisualPanel
            v-if="!visualCollapsed"
            :vm="rawVm"
            :selected="selected"
            :format-database-version="formatDatabaseVersion"
          />
        </div>

        <div v-else class="database-empty">
          <ServerCrash :size="18" />
          <span>请选择左侧一个数据库连接开始查看和查询。</span>
        </div>
      </main>
    </div>

    <DatabaseConnectionEditor
      :editor-visible="editorVisible"
      :editor-mode="editorMode"
      :editor-saving="editorSaving"
      :editor-error="editorError"
      :password-visible="passwordVisible"
      :editor-form="editorForm"
      :engine-options="ENGINE_OPTIONS"
      :handle-engine-change="handleEngineChange"
      :close-editor="closeEditor"
      :submit-editor="submitEditor"
      @update:password-visible="passwordVisible = $event"
    />
  </section>
</template>
