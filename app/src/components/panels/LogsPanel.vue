<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel logs-panel">
    <div class="serial-head">
      <div>
        <h3>操作日志</h3>
        <p class="hosts-header-sub">按服务器/目标分组，点开查看该目标完整历史操作</p>
      </div>
      <div class="serial-head-actions">
        <button class="ghost" @click="vm.refreshAuditLogs">刷新</button>
        <button class="danger" @click="vm.clearAuditLogs">清空日志</button>
      </div>
    </div>
    <div class="grid logs-filter-grid">
      <select v-model="vm.auditSource.value">
        <option value="all">全部来源</option>
        <option value="ssh">SSH</option>
        <option value="serial">串口</option>
        <option value="local">本地终端</option>
        <option value="app">系统</option>
      </select>
      <input v-model="vm.auditKeyword.value" placeholder="搜索目标 / 命令 / 错误信息" />
      <button class="muted" @click="vm.refreshAuditLogs">按条件过滤</button>
      <span class="hosts-stat">{{ vm.auditStatus.value || '未加载' }}</span>
    </div>
    <div class="logs-split">
      <aside class="logs-target-list">
        <button
          v-for="group in vm.auditTargetGroups.value"
          :key="`target-${group.target}`"
          class="logs-target-item"
          :class="{ active: vm.selectedAuditTarget.value === group.target }"
          @click="vm.selectedAuditTarget.value = group.target"
        >
          <div class="logs-target-name">{{ group.target }}</div>
          <div class="logs-target-meta">
            <span>{{ vm.formatAuditSource(group.source) }}</span>
            <span>{{ group.count }} 条</span>
          </div>
          <div class="logs-target-time">{{ vm.formatAuditTime(group.lastTs) }}</div>
        </button>
        <div v-if="vm.auditTargetGroups.value.length === 0" class="file-row empty">暂无目标</div>
      </aside>
      <div class="logs-list">
        <article v-for="item in vm.currentAuditLogs.value" :key="item.id" class="log-item">
          <header>
            <span class="log-time">{{ vm.formatAuditTime(item.ts) }}</span>
            <span class="pill">{{ vm.formatAuditSource(item.source) }}</span>
            <span class="pill ghost">{{ vm.formatAuditAction(item.action) }}</span>
          </header>
          <div class="log-target">{{ item.target || '未命名目标' }}</div>
          <pre>{{ item.content || '-' }}</pre>
        </article>
        <div v-if="vm.currentAuditLogs.value.length === 0" class="file-row empty">请选择左侧目标查看详情</div>
      </div>
    </div>
  </section>
</template>
