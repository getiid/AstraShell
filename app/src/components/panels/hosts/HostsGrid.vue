<script setup lang="ts">
import { Activity, Monitor, Pencil, Trash2 } from 'lucide-vue-next'
import type { Ref } from 'vue'

defineProps<{
  hostEditorVisible: Ref<boolean>
  filteredHosts: Ref<any[]>
  selectedHostId: Ref<string>
  defaultCategory: string
  useHost: (host: any) => void
  openHostTerminal: (host: any) => void
  hostProbeTitle: (host: any) => string
  testHostReachability: (host: any) => void
  hostProbeClass: (hostId: string) => string
  hostConnectedSessionCount: (host: any) => number
  openExistingHostTerminal: (host: any) => void
  openHostEditor: (host: any) => void
  deleteHost: (host: any) => void
  authLabel: (item: any) => string
  probeLabel: (item: any) => string
}>()
</script>

<template>
  <div class="host-grid" :class="{ 'editor-open': hostEditorVisible.value }">
    <article
      v-for="h in filteredHosts.value"
      :key="h.id"
      class="host-card"
      :class="{ activeHost: selectedHostId.value === h.id }"
      @click="useHost(h)"
      @dblclick="openHostTerminal(h)"
    >
      <div class="host-card-top">
        <div class="host-card-main">
          <span class="host-icon">{{ (h.auth_type || h.authType) === 'key' ? '🔑' : '🖥' }}</span>
          <div class="host-card-body">
            <div class="host-card-title-row">
              <div class="host-card-title">{{ h.name }}</div>
              <span class="pill ghost">{{ authLabel(h) }}</span>
            </div>
            <div class="host-line">{{ h.username }}@{{ h.host }} · {{ Number(h.port || 22) }}</div>
          </div>
        </div>
      </div>

      <div class="host-card-tags">
        <span class="host-mini-pill">{{ h.category || defaultCategory }}</span>
        <span class="host-mini-pill">双击直连</span>
      </div>

      <div class="host-card-foot">
        <div class="host-health-line">
          <button class="status-dot-btn" :title="hostProbeTitle(h)" @click.stop="testHostReachability(h)">
            <span class="status-dot" :class="hostProbeClass(h.id)"></span>
          </button>
          <span class="host-health-text">{{ probeLabel(h) }}</span>
        </div>
        <div class="host-card-actions">
          <button
            v-if="hostConnectedSessionCount(h) > 0"
            class="host-session-entry"
            :title="`进入已打开会话（${hostConnectedSessionCount(h)}）`"
            @click.stop="openExistingHostTerminal(h)"
          >
            <Monitor :size="13" />
            <span v-if="hostConnectedSessionCount(h) > 1" class="host-session-entry-count">
              {{ hostConnectedSessionCount(h) }}
            </span>
          </button>
          <button class="ghost tiny" @click.stop="openHostTerminal(h)">连接</button>
          <button class="host-edit-btn" title="编辑主机" @click.stop="openHostEditor(h)">
            <Pencil :size="12" />
          </button>
          <button
            class="host-delete-btn"
            title="删除主机"
            @click.stop="deleteHost(h)"
          >
            <Trash2 :size="12" />
          </button>
        </div>
      </div>
    </article>

    <div v-if="filteredHosts.value.length === 0" class="hosts-empty-state">
      <div class="hosts-empty-icon">
        <Activity :size="18" />
      </div>
      <strong>当前没有可显示的主机</strong>
      <p>可以新建服务器，或切换左侧分类后继续管理。</p>
    </div>
  </div>
</template>
