<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cable, Database, FolderTree, KeyRound, Logs, Pencil, Search, Server, Settings, SquareTerminal } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()
const keyword = ref('')

const navItems = [
  { key: 'hosts', label: '主机管理', sublabel: 'SSH 服务器资产', icon: Server },
  { key: 'sftp', label: '文件传输', sublabel: 'SFTP 工作区', icon: FolderTree },
  { key: 'local', label: '本地终端', sublabel: 'Shell / PowerShell', icon: SquareTerminal },
  { key: 'database', label: '数据库连接', sublabel: '多引擎数据库', icon: Database },
  { key: 'serial', label: '串口工具', sublabel: '设备调试控制台', icon: Cable },
  { key: 'snippets', label: '代码片段', sublabel: '分类执行脚本', icon: Pencil },
  { key: 'vault', label: '密钥管理', sublabel: 'Vault 凭据中心', icon: KeyRound },
  { key: 'settings', label: '应用设置', sublabel: '同步 / 更新 / 安全', icon: Settings },
  { key: 'logs', label: '操作日志', sublabel: '聚合日志中心', icon: Logs },
]

const filteredNavItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return navItems
  return navItems.filter((item) =>
    `${item.label} ${item.sublabel}`.toLowerCase().includes(q),
  )
})
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="brand brand-card">
        <img src="/logo-astrashell-app.png?v=11" alt="AstraShell Logo" class="brand-logo" />
        <div class="brand-copy">
          <strong>AstraShell</strong>
          <span>默认工作区</span>
        </div>
      </div>
      <label class="sidebar-search">
        <Search :size="14" />
        <input v-model="keyword" type="text" placeholder="搜索模块" />
      </label>
    </div>
    <ul class="sidebar-nav">
      <li
        v-for="item in filteredNavItems"
        :key="item.key"
        class="sidebar-nav-item"
        :class="{ active: vm.nav.value === item.key }"
        @click="vm.selectNav(item.key)"
      >
        <div class="sidebar-nav-icon">
          <component :is="item.icon" :size="16" />
        </div>
        <div class="sidebar-nav-copy">
          <strong>{{ item.label }}</strong>
          <span>{{ item.sublabel }}</span>
        </div>
        <span v-if="vm.navCounts?.[item.key] != null" class="sidebar-nav-badge">{{ vm.navCounts[item.key] }}</span>
      </li>
    </ul>
    <div class="sidebar-footer">
      <div class="sidebar-footer-status">
        <span class="sidebar-footer-dot"></span>
        <span>{{ vm.footerStatus || '所有服务运行正常' }}</span>
      </div>
      <div class="sidebar-footer-text">
        <div class="sidebar-footer-title">{{ vm.versionLabel || 'v0.3.20' }}</div>
        <div class="sidebar-footer-sub">AstraShell Workbench</div>
      </div>
      <div class="sidebar-footer-links">
        <a class="sidebar-footer-link" href="http://astrashell.851108.xyz" target="_blank" rel="noreferrer">官网</a>
        <a class="sidebar-footer-link" href="https://github.com/getiid/AstraShell" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </div>
  </aside>
</template>
