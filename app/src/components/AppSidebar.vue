<script setup lang="ts">
import { Cable, FolderTree, KeyRound, Pencil, Server, Settings } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()

const navItems = [
  { key: 'hosts', label: '主机管理', icon: Server },
  { key: 'sftp', label: '文件传输', icon: FolderTree },
  { key: 'snippets', label: '代码片段', icon: Pencil },
  { key: 'serial', label: '串口工具', icon: Cable },
  { key: 'local', label: '本地终端', icon: Server },
  { key: 'vault', label: '密钥管理', icon: KeyRound },
  { key: 'settings', label: '应用设置', icon: Settings },
  { key: 'logs', label: '操作日志', icon: Pencil },
]
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <img src="/logo-astrashell.png?v=12" alt="AstraShell Banner" class="brand-logo brand-logo-wide" />
    </div>
    <ul class="sidebar-nav">
      <li
        v-for="item in navItems"
        :key="item.key"
        :class="{ active: vm.nav.value === item.key }"
        @click="vm.selectNav(item.key)"
      >
        <component :is="item.icon" :size="16" />
        {{ item.label }}
      </li>
    </ul>
    <div class="sidebar-footer">
      <img src="/logo-astrashell-app.png?v=11" alt="AstraShell Logo" class="sidebar-footer-logo sidebar-footer-logo-wide" />
      <div class="sidebar-footer-text">
        <div class="sidebar-footer-title">AstraShell</div>
        <div class="sidebar-footer-sub">制作人：GetIDC</div>
        <a class="sidebar-footer-link" href="http://astrashell.851108.xyz" target="_blank" rel="noreferrer">astrashell.851108.xyz</a>
      </div>
    </div>
  </aside>
</template>
