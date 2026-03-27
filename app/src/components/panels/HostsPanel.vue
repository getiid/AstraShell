<script setup lang="ts">
import { toRaw } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import HostEditorPanel from './hosts/HostEditorPanel.vue'
import HostsCategorySidebar from './hosts/HostsCategorySidebar.vue'
import HostsGrid from './hosts/HostsGrid.vue'
import HostsSpotlight from './hosts/HostsSpotlight.vue'
import { useHostsPanelController } from './hosts/useHostsPanelController'

const { vm } = defineProps<{ vm: any }>()
const rawVm = toRaw(vm)

const {
  WARNING_DAYS,
  totalHosts,
  filteredHostsCount,
  selectedHost,
  currentCategoryLabel,
  secondaryCategories,
  hostCategoryMenu,
  countByCategory,
  authLabel,
  getHostExpiryDate,
  probeLabel,
  daysUntilExpiry,
  expiryText,
  expiringHosts,
  jumpToExpiringHost,
  saveDateFieldIfExisting,
  openHostCategoryMenu,
  renameHostCategoryFromMenu,
  deleteHostCategoryFromMenu,
} = useHostsPanelController(vm)
</script>

<template>
  <section class="panel hosts-panel">
    <div class="hosts-shell">
      <header class="hosts-hero">
        <div class="hosts-hero-copy">
          <div class="hosts-hero-title-row">
            <div class="hosts-hero-headline">
              <span class="hosts-kicker">SSH WORKSPACE</span>
              <h3>主机管理</h3>
            </div>
            <span class="hosts-header-sub hosts-header-inline">{{ currentCategoryLabel }} · {{ filteredHostsCount }} / {{ totalHosts }} 台</span>
          </div>
          <div class="hosts-expiry-strip" :class="{ quiet: expiringHosts.length === 0 }">
            <div class="hosts-expiry-label">
              <TriangleAlert :size="14" />
              <span>到期预警</span>
            </div>
            <div v-if="expiringHosts.length > 0" class="hosts-expiry-list">
              <button
                v-for="entry in expiringHosts.slice(0, 4)"
                :key="entry.item.id"
                class="hosts-expiry-item"
                :class="{ danger: Number(entry.days) <= 3 }"
                @click="jumpToExpiringHost(entry.item)"
              >
                <strong>{{ entry.item.name }}</strong>
                <span>{{ expiryText(entry.days) }}</span>
              </button>
              <span v-if="expiringHosts.length > 4" class="hosts-expiry-more">还有 {{ expiringHosts.length - 4 }} 台待处理</span>
            </div>
            <span v-else class="hosts-expiry-empty">未来 {{ WARNING_DAYS }} 天内没有到期主机</span>
          </div>
        </div>

        <div class="hosts-quick-card">
          <div class="hosts-quick-card-head">
            <strong>快速连接</strong>
            <span>输入地址后可直接连接，也可以顺手保存到主机库。</span>
          </div>
          <div class="hosts-quick-connect">
            <input
              v-model="vm.quickConnectInput.value"
              placeholder="SSH 快速连接，例如 root@1.2.3.4 或 admin@1.2.3.4:22"
              @keyup.enter="vm.connectSSHFromHosts"
            />
            <button class="ghost small" @click="vm.saveCurrentHost">保存到主机库</button>
            <button class="muted small" @click="vm.connectSSHFromHosts">立即连接</button>
          </div>
        </div>
      </header>

      <div class="hosts-layout new-layout">
        <HostsCategorySidebar
          :vm="rawVm"
          :secondary-categories="secondaryCategories"
          :count-by-category="countByCategory"
          :open-host-category-menu="openHostCategoryMenu"
        />

        <main class="hosts-center">
          <HostsSpotlight
            :vm="rawVm"
            :selected-host="selectedHost"
            :auth-label="authLabel"
            :probe-label="probeLabel"
            :get-host-expiry-date="getHostExpiryDate"
            :days-until-expiry="daysUntilExpiry"
            :expiry-text="expiryText"
          />
          <HostsGrid
            :host-editor-visible="vm.hostEditorVisible"
            :filtered-hosts="vm.filteredHosts"
            :selected-host-id="vm.selectedHostId"
            :default-category="vm.defaultCategory"
            :use-host="vm.useHost"
            :open-host-terminal="vm.openHostTerminal"
            :host-probe-title="vm.hostProbeTitle"
            :test-host-reachability="vm.testHostReachability"
            :host-probe-class="vm.hostProbeClass"
            :host-connected-session-count="vm.hostConnectedSessionCount"
            :open-existing-host-terminal="vm.openExistingHostTerminal"
            :open-host-editor="vm.openHostEditor"
            :delete-host="(host) => { vm.selectedHostId.value = host.id; vm.deleteCurrentHost() }"
            :auth-label="authLabel"
            :probe-label="probeLabel"
          />
        </main>

        <HostEditorPanel
          :host-editor-visible="vm.hostEditorVisible"
          :editing-host="vm.editingHost"
          :host-categories="vm.hostCategories"
          :edit-password-visible="vm.editPasswordVisible"
          :vault-items="vm.vaultItems"
          :save-edited-host="vm.saveEditedHost"
          :save-date-field-if-existing="saveDateFieldIfExisting"
        />
      </div>
    </div>
    <div
      v-if="hostCategoryMenu.visible"
      class="context-menu"
      :style="{ left: `${hostCategoryMenu.x}px`, top: `${hostCategoryMenu.y}px` }"
      @click.stop
    >
      <button class="menu-item" @click="renameHostCategoryFromMenu">重命名</button>
      <button class="menu-item danger" @click="deleteHostCategoryFromMenu">删除</button>
    </div>
  </section>
</template>
