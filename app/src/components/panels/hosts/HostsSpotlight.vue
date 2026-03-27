<script setup lang="ts">
import { Server, Shield } from 'lucide-vue-next'

defineProps<{
  vm: any
  selectedHost: any
  authLabel: (item: any) => string
  probeLabel: (item: any) => string
  getHostExpiryDate: (item: any) => string
  daysUntilExpiry: (value: string) => number | null
  expiryText: (days: number | null) => string
}>()
</script>

<template>
  <section class="hosts-spotlight" :class="{ empty: !selectedHost }">
    <template v-if="selectedHost">
      <div class="hosts-spotlight-main">
        <div class="hosts-spotlight-icon slim">
          <Server :size="18" />
        </div>
        <div class="hosts-spotlight-copy">
          <span class="hosts-spotlight-label">当前聚焦</span>
          <strong>{{ selectedHost.name }}</strong>
          <p>{{ selectedHost.username }}@{{ selectedHost.host }}<template v-if="Number(selectedHost.port || 22) !== 22">:{{ selectedHost.port }}</template></p>
        </div>
        <div class="hosts-spotlight-meta">
          <span class="pill ghost">{{ selectedHost.category || vm.defaultCategory }}</span>
          <span class="pill ghost">{{ authLabel(selectedHost) }}</span>
          <span class="pill ghost">{{ probeLabel(selectedHost) }}</span>
          <span v-if="getHostExpiryDate(selectedHost)" class="pill ghost danger">{{ expiryText(daysUntilExpiry(getHostExpiryDate(selectedHost))) }}</span>
        </div>
      </div>
      <div class="hosts-spotlight-actions">
        <button class="ghost small" :disabled="vm.hostProbeRunning.value || vm.filteredHosts.value.length === 0" @click="vm.probeFilteredHosts">
          {{ vm.hostProbeRunning.value ? '检测中...' : '检测当前列表' }}
        </button>
        <button class="muted small" @click="vm.openCreateHostEditor">新建服务器</button>
      </div>
    </template>
    <template v-else>
      <div class="hosts-spotlight-main">
        <div class="hosts-spotlight-icon empty slim">
          <Shield :size="18" />
        </div>
        <div class="hosts-spotlight-copy">
          <span class="hosts-spotlight-label">当前聚焦</span>
          <strong>先选一台服务器</strong>
          <p>下方主机卡片支持单击聚焦、双击直连，右侧会同步打开编辑面板。</p>
        </div>
      </div>
      <div class="hosts-spotlight-actions">
        <button class="ghost small" :disabled="vm.hostProbeRunning.value || vm.filteredHosts.value.length === 0" @click="vm.probeFilteredHosts">
          {{ vm.hostProbeRunning.value ? '检测中...' : '检测当前列表' }}
        </button>
        <button class="muted small" @click="vm.openCreateHostEditor">新建服务器</button>
      </div>
    </template>
  </section>
</template>
