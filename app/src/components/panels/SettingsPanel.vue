<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel">
    <h3>应用设置</h3>
    <p class="hint">统一管理应用更新、数据备份与数据库同步。</p>
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

    <h3>同步中心</h3>
    <p>{{ vm.syncStatusText.value }}</p>
    <div class="storage-backup-card">
      <div class="hosts-left-title">
        <span>同步配置</span>
        <span class="hosts-stat">运行时固定使用本地数据库，外部数据库文件只负责同步</span>
      </div>
      <div class="grid startup-auth-grid">
        <label class="serial-inline-check"><input v-model="vm.syncEnabled.value" type="checkbox" /> 启用同步</label>
        <label class="serial-inline-check"><input v-model="vm.syncAutoPullOnStartup.value" type="checkbox" /> 启动后后台下载</label>
        <label class="serial-inline-check"><input v-model="vm.syncAutoPushOnChange.value" type="checkbox" /> 本地变更后自动上传</label>
        <input v-model.number="vm.syncDebounceMs.value" type="number" min="300" step="100" placeholder="自动上传防抖 ms" />
      </div>
      <div class="storage-path-row">
        <input
          v-model="vm.syncTargetPath.value"
          placeholder="同步数据库文件（建议放在 iCloud / U盘 / SMB / NAS 挂载目录）"
        />
        <div class="storage-path-actions">
          <button class="muted tiny" :disabled="vm.syncBusy.value" @click="vm.pickSyncSaveFile">新建数据库</button>
          <button class="muted tiny" :disabled="vm.syncBusy.value" @click="vm.pickSyncFile">选择数据库</button>
        </div>
      </div>
      <p class="hint">先选好同步数据库文件，确认自动同步选项，最后再点击保存配置。</p>
      <div class="storage-path-actions">
        <button class="muted tiny" :disabled="vm.syncBusy.value" @click="vm.refreshSyncStatus">刷新状态</button>
        <button class="tiny" :disabled="vm.syncBusy.value" @click="vm.saveSyncConfig">保存配置</button>
      </div>
      <p>{{ vm.syncMsg.value }}</p>
      <p class="hint">最近上传：{{ vm.formatSyncTime(vm.syncState.value.lastPushAt) }} ｜ 最近下载：{{ vm.formatSyncTime(vm.syncState.value.lastPullAt) }} ｜ 队列：{{ vm.syncQueueCount.value }}</p>
      <p class="hint">远端：{{ vm.syncRemoteMeta.value?.path || vm.syncTargetPath.value || '-' }} ｜ rev：{{ vm.syncRemoteMeta.value?.revision ?? 0 }} ｜ 文件：{{ vm.syncRemoteMeta.value?.exists ? '存在' : '不存在' }}</p>
      <div class="storage-path-actions">
        <button class="tiny" :disabled="vm.syncBusy.value" @click="vm.syncPullNow">立即下载</button>
        <button class="tiny" :disabled="vm.syncBusy.value" @click="vm.syncPushNow">立即上传</button>
        <button class="muted tiny" :disabled="vm.syncBusy.value" @click="vm.syncRetryFailed">重试失败任务</button>
        <button class="ghost tiny" :disabled="vm.syncBusy.value" @click="vm.clearSyncQueue">清空队列</button>
      </div>
      <div class="storage-path-row">
        <select>
          <option value="">同步队列</option>
          <option v-for="item in vm.syncQueueItems.value" :key="item.id" :value="item.id">
            {{ item.type }} ｜ rev {{ item.baseRevision || 0 }} ｜ 尝试 {{ item.attempts || 0 }} 次 ｜ {{ item.error || item.reason || '待执行' }}
          </option>
        </select>
        <div class="storage-path-actions">
          <button class="muted tiny" :disabled="vm.syncBusy.value" @click="vm.refreshSyncQueue">刷新队列</button>
        </div>
      </div>
      <p class="hint">同步失败时可以先立即下载、立即上传或重试失败任务；仍有问题时再回到上面的备份恢复。</p>
    </div>

    <div class="divider"></div>

    <h3>数据备份</h3>
    <p class="hint">本地数据库固定保存在应用目录中，这里只保留备份与恢复入口。</p>
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
    <p>{{ vm.storageMsg.value }}</p>
    <p class="hint">共享文件只保存：主机 / 片段 / 密钥 / 快捷工具。日志仍保存在本地，不参与多端同步。</p>
  </section>
</template>
