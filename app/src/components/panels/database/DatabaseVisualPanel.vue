<script setup lang="ts">
import { Table2 } from 'lucide-vue-next'

defineProps<{
  vm: any
  selected: any
  formatDatabaseVersion: (item: any) => string
}>()
</script>

<template>
  <aside class="database-visual-panel" @click.stop>
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
</template>
