<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel">
    <h3>应用设置</h3>
    <p class="hint">统一管理应用更新与本地数据文件目录。</p>
    <div class="divider"></div>

    <h3>应用更新</h3>
    <p>{{ vm.updateStatusText.value }}</p>
    <div class="grid update-grid">
      <button class="muted" :disabled="vm.updateActionBusy.value || vm.updateInfo.value.checking" @click="vm.checkAppUpdate">检查更新</button>
      <button
        class="muted"
        :disabled="vm.updateActionBusy.value || !vm.updateInfo.value.hasUpdate || vm.updateInfo.value.downloaded"
        @click="vm.downloadAppUpdate"
      >
        下载更新
      </button>
      <button :disabled="vm.updateActionBusy.value || !vm.updateInfo.value.downloaded" @click="vm.installAppUpdate">重启并安装</button>
      <button class="ghost" :disabled="vm.updateActionBusy.value" @click="vm.refreshUpdateState">刷新状态</button>
    </div>
    <div v-if="vm.updateInfo.value.downloading" class="update-progress">
      <div class="update-progress-bar"><div class="update-progress-fill" :style="{ width: `${vm.updateInfo.value.progress}%` }"></div></div>
      <span>{{ Math.round(vm.updateInfo.value.progress) }}%</span>
    </div>
    <div v-if="vm.showManualMacUpdate.value" class="manual-update-card">
      <div class="manual-update-head">
        <strong>mac 当前版本需手动安装</strong>
        <span>点击下方链接后会在浏览器中直接下载 DMG 到本地文件夹。</span>
      </div>
      <div class="manual-update-actions">
        <button class="muted" @click="vm.openManualUpdateLink(vm.updateInfo.value.downloadUrl)">下载 DMG</button>
        <button
          v-if="vm.updateInfo.value.releaseUrl"
          class="ghost"
          @click="vm.openManualUpdateLink(vm.updateInfo.value.releaseUrl)"
        >
          打开 Release 页面
        </button>
      </div>
      <a class="manual-update-link" :href="vm.updateInfo.value.downloadUrl" target="_blank" rel="noreferrer">{{ vm.updateInfo.value.downloadUrl }}</a>
    </div>
    <p class="hint">官网：<a class="manual-update-link" href="http://astrashell.851108.xyz" target="_blank" rel="noreferrer">http://astrashell.851108.xyz</a></p>
    <p class="hint">发布新版本到 GitHub Release 后，应用启动会自动检查；也可手动检查并一键更新。</p>

    <div class="divider"></div>

    <h3>本地存储</h3>
    <p>当前数据文件：{{ vm.storageDbPath.value }}</p>
    <div class="storage-path-row">
      <input v-model="vm.storagePathInput.value" placeholder="输入共享路径（可填目录或 .json/.db 文件）" />
      <div class="storage-path-actions">
        <button class="muted tiny" @click="vm.pickStorageFile">选文件</button>
        <button class="muted tiny" @click="vm.pickStorageFolder">选目录</button>
        <button class="tiny" @click="vm.applyStoragePath">应用</button>
        <button class="muted tiny" @click="vm.refreshStorageDataNow">刷新</button>
      </div>
    </div>
    <p>{{ vm.storageMsg.value }}</p>
    <p class="hint">{{ vm.storageMetaText.value || '正在读取数据文件状态...' }}</p>
    <div class="storage-backup-card">
      <div class="hosts-left-title">
        <span>数据备份</span>
        <span class="hosts-stat">防止异常导致数据丢失</span>
      </div>
      <div class="storage-path-actions">
        <button class="muted tiny" @click="vm.createDataBackup">立即备份</button>
        <button class="muted tiny" @click="vm.refreshBackupList">刷新备份列表</button>
        <button class="tiny" @click="vm.openBackupsFolder">打开备份位置</button>
      </div>
      <div class="storage-path-row">
        <select v-model="vm.selectedBackupPath.value">
          <option value="">请选择备份文件</option>
          <option v-for="item in vm.backupItems.value" :key="item.path" :value="item.path">
            {{ new Date(item.mtimeMs).toLocaleString() }} ｜ {{ item.name }}
          </option>
        </select>
        <div class="storage-path-actions">
          <button class="danger tiny" @click="vm.restoreDataBackup">恢复备份</button>
        </div>
      </div>
    </div>
    <p class="hint">建议直接选择同一个 `astrashell.data.json` 文件；也可填目录（会自动拼接默认文件名）。把文件放到 iCloud/OneDrive/共享盘/U 盘即可跨设备读取同一份数据。</p>
    <p class="hint">共享文件只保存：主机 / 片段 / 密钥 / 快捷工具。日志为本地数据，不参与多端同步。</p>
  </section>
</template>
