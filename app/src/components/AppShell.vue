<script setup lang="ts">
import { useAppShellController } from './useAppShellController'
import AppSidebar from './AppSidebar.vue'
import AppStatusBar from './AppStatusBar.vue'
import DatabasePanel from './panels/DatabasePanel.vue'
import HostsPanel from './panels/HostsPanel.vue'
import LocalPanel from './panels/LocalPanel.vue'
import LogsPanel from './panels/LogsPanel.vue'
import SerialPanel from './panels/SerialPanel.vue'
import SettingsPanel from './panels/SettingsPanel.vue'
import SftpPanel from './panels/SftpPanel.vue'
import SnippetsPanel from './panels/SnippetsPanel.vue'
import StartupGateOverlay from './StartupGateOverlay.vue'
import TerminalWorkspace from './TerminalWorkspace.vue'
import TextContextMenu from './TextContextMenu.vue'
import VaultPanel from './panels/VaultPanel.vue'
import '@xterm/xterm/css/xterm.css'

const {
  nav,
  focusTerminal,
  terminalWorkspaceVm,
  sftpPanelVm,
  snippetsPanelVm,
  logsPanelVm,
  databasePanelVm,
  serialPanelVm,
  localPanelVm,
  hostsPanelVm,
  settingsPanelVm,
  vaultPanelVm,
  sidebarVm,
  textContextMenuVm,
  statusBarVm,
  startupGateVm,
} = useAppShellController()
</script>

<template>
  <div class="layout" :class="{ 'terminal-layout': focusTerminal }">
    <AppSidebar :vm="sidebarVm" />

    <main class="main">
      <TerminalWorkspace :vm="terminalWorkspaceVm" />

      <HostsPanel v-if="!focusTerminal && nav === 'hosts'" :vm="hostsPanelVm" />
      <SftpPanel v-else-if="!focusTerminal && nav === 'sftp'" :vm="sftpPanelVm" />
      <SnippetsPanel v-else-if="!focusTerminal && nav === 'snippets'" :vm="snippetsPanelVm" />
      <SerialPanel v-else-if="!focusTerminal && nav === 'serial'" :vm="serialPanelVm" />
      <LocalPanel v-else-if="!focusTerminal && nav === 'local'" :vm="localPanelVm" />
      <DatabasePanel v-else-if="!focusTerminal && nav === 'database'" :vm="databasePanelVm" />
      <VaultPanel v-else-if="!focusTerminal && nav === 'vault'" :vm="vaultPanelVm" />
      <SettingsPanel v-else-if="!focusTerminal && nav === 'settings'" :vm="settingsPanelVm" />
      <LogsPanel v-else-if="!focusTerminal && nav === 'logs'" :vm="logsPanelVm" />
      <section v-else-if="!focusTerminal" class="panel"><h3>模块建设中</h3><p>当前页面：{{ nav }}</p></section>

      <TextContextMenu :vm="textContextMenuVm" />
    </main>

    <AppStatusBar :vm="statusBarVm" />
    <StartupGateOverlay :vm="startupGateVm" />
  </div>
</template>
