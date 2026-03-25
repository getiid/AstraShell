<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel sftp-panel">
    <h3>SFTP 文件传输</h3>
    <div class="sftp-status-line">
      <span class="status-pill" :class="{ online: vm.sftpConnected.value }">{{ vm.sftpConnected.value ? '已连接' : '未连接' }}</span>
      <span class="status-pill mode">{{ vm.sftpTransferModeLabel.value }}</span>
      <span class="status-pill plain">{{ vm.sftpStatus.value || '就绪' }}</span>
    </div>
    <div class="split-head">
      <div class="head-left">
        <article class="path-chip">
          <header>
            <b>左侧连接</b>
            <em>{{ vm.leftPanelStateLabel.value }}</em>
          </header>
          <span>{{ vm.leftLinkLabel.value }}</span>
          <small>{{ vm.leftPanelMode.value === 'local' ? vm.leftLocalPathDisplay.value : vm.leftSftpPath.value }}</small>
          <i>共 {{ vm.leftDisplayRows.value.length }} 项</i>
        </article>
        <article class="path-chip">
          <header>
            <b>右侧连接</b>
            <em>{{ vm.rightPanelStateLabel.value }}</em>
          </header>
          <span>{{ vm.rightLinkLabel.value }}</span>
          <small>{{ vm.rightPanelMode.value === 'local' ? vm.rightLocalPathDisplay.value : vm.sftpPath.value }}</small>
          <i>共 {{ vm.rightDisplayRows.value.length }} 项</i>
        </article>
      </div>
    </div>

    <div class="split">
      <div class="file-panel local-panel" @dragover.prevent @drop="vm.onLeftDrop">
        <div class="file-panel-head">
          <h4>{{ vm.leftPanelMode.value === 'local' ? '左侧：本地（可接收远程拖拽下载）' : '左侧：远程浏览' }}</h4>
          <div class="file-head-actions">
            <button class="ghost small" @click="vm.localGoUp">上一级</button>
            <button class="ghost small" @click="vm.leftPanelMode.value === 'local' ? vm.loadLocalFs() : vm.loadLeftSftp()">刷新</button>
            <button class="ghost small" @click="vm.toggleLeftConnectPanel">链接</button>
            <select v-model="vm.localSortBy.value" class="file-sort">
              <option value="name">A-Z 排序</option>
              <option value="createdAt">创建时间</option>
              <option value="modifiedAt">修改时间</option>
            </select>
          </div>
        </div>
        <div v-if="vm.leftConnectPanelOpen.value" class="connect-inline">
          <div class="connect-filters">
            <select v-model="vm.leftConnectCategory.value">
              <option :value="vm.allCategory">全部分类</option>
              <option v-for="c in vm.hostCategories.value" :key="`left-cat-${c}`" :value="c">{{ c }}</option>
            </select>
            <input v-model="vm.leftConnectKeyword.value" placeholder="搜索服务器/IP/用户名" />
          </div>
          <select v-model="vm.leftConnectTarget.value">
            <option value="local">本地目录</option>
            <optgroup v-for="group in vm.leftConnectGroups.value" :key="`left-group-${group.category}`" :label="group.category">
              <option v-for="h in group.items" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
            </optgroup>
          </select>
          <button @click="vm.connectLeftPanel">切换左侧</button>
        </div>
        <div class="file-search-row">
          <input v-model="vm.leftFileKeyword.value" placeholder="筛选当前左侧文件列表" />
        </div>
        <div class="file-stack">
          <div
            v-for="l in vm.leftDisplayRows.value"
            :key="vm.leftPanelMode.value === 'local' ? l.path : l.filename"
            class="file-row"
            :class="{ 'is-dir': l.isDir, active: vm.leftPanelMode.value === 'local' ? vm.selectedLocalFile.value === l.path : vm.selectedRemoteFile.value === l.filename }"
            :draggable="vm.leftPanelMode.value === 'local' && !l.isDir"
            @click="vm.openLeftItem(l)"
            @dragstart="vm.onLeftDragStart(l)"
          >
            <div class="file-info">
              <span class="file-icon">{{ l.isDir ? '📁' : '📄' }}</span>
              <span class="file-name">{{ vm.leftPanelMode.value === 'local' ? l.name : l.filename }}</span>
            </div>
            <div class="file-meta">
              <span>{{ l.isDir ? '目录' : (vm.leftPanelMode.value === 'local' ? '文件' : (l.size ?? '-')) }}</span>
              <span>{{ vm.formatFsTime(vm.leftPanelMode.value === 'local' ? l.modifiedAt : (l.modifiedAt || l.mtime)) }}</span>
            </div>
          </div>
          <div v-if="vm.leftDisplayRows.value.length === 0" class="file-row empty">目录空</div>
        </div>
      </div>

      <div class="file-panel remote-panel" @dragover.prevent @drop="vm.onRightDrop">
        <div class="file-panel-head">
          <h4>{{ vm.rightPanelMode.value === 'remote' ? '右侧：远程（可接收本地拖拽上传）' : '右侧：本地目录' }}</h4>
          <div class="file-head-actions">
            <button class="ghost small" @click="vm.remoteGoUp">上一级</button>
            <button class="ghost small" @click="vm.loadSftp">刷新</button>
            <button v-if="vm.rightPanelMode.value === 'remote'" class="ghost small" @click="vm.promptMkdirSftp">新建目录</button>
            <button class="ghost small" @click="vm.toggleRightConnectPanel">链接</button>
            <select v-model="vm.remoteSortBy.value" class="file-sort">
              <option value="name">A-Z 排序</option>
              <option value="createdAt">创建时间</option>
              <option value="modifiedAt">修改时间</option>
            </select>
          </div>
        </div>
        <div v-if="vm.rightConnectPanelOpen.value" class="connect-inline">
          <div class="connect-filters">
            <select v-model="vm.rightConnectCategory.value">
              <option :value="vm.allCategory">全部分类</option>
              <option v-for="c in vm.hostCategories.value" :key="`right-cat-${c}`" :value="c">{{ c }}</option>
            </select>
            <input v-model="vm.rightConnectKeyword.value" placeholder="搜索服务器/IP/用户名" />
          </div>
          <select v-model="vm.rightConnectTarget.value">
            <option value="local">本地目录</option>
            <optgroup v-for="group in vm.rightConnectGroups.value" :key="`right-group-${group.category}`" :label="group.category">
              <option v-for="h in group.items" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
            </optgroup>
          </select>
          <button @click="vm.connectSftp">切换右侧</button>
        </div>
        <div class="file-search-row">
          <input v-model="vm.rightFileKeyword.value" placeholder="筛选当前右侧文件列表" />
        </div>
        <div class="file-stack">
          <div
            v-for="r in vm.rightDisplayRows.value"
            :key="vm.rightPanelMode.value === 'remote' ? r.filename : r.path"
            class="file-row"
            :class="{ 'is-dir': r.isDir, active: vm.rightPanelMode.value === 'remote' ? vm.selectedRemoteFile.value === r.filename : vm.selectedLocalFile.value === r.path }"
            :draggable="!r.isDir"
            @click="vm.openRightItem(r)"
            @contextmenu="vm.rightPanelMode.value === 'remote' ? vm.showRemoteMenu($event, r) : undefined"
            @dragstart="vm.onRightDragStart(r)"
          >
            <div class="file-info">
              <span class="file-icon">{{ r.isDir ? '📁' : '📄' }}</span>
              <span class="file-name">{{ vm.rightPanelMode.value === 'remote' ? r.filename : r.name }}</span>
            </div>
            <div class="file-meta">
              <span>{{ r.isDir ? '目录' : (vm.rightPanelMode.value === 'remote' ? (r.size ?? '-') : '文件') }}</span>
              <span>{{ r.isDir ? '' : vm.formatFsTime(vm.rightPanelMode.value === 'remote' ? (r.modifiedAt || r.mtime) : r.modifiedAt) }}</span>
            </div>
          </div>
          <div v-if="vm.rightDisplayRows.value.length === 0" class="file-row empty">目录空</div>
        </div>
      </div>
    </div>

    <div
      v-if="vm.rightPanelMode.value === 'remote' && vm.remoteMenu.value.visible"
      class="context-menu"
      :style="{ left: `${vm.remoteMenu.value.x}px`, top: `${vm.remoteMenu.value.y}px` }"
    >
      <button class="menu-item" @click="vm.menuDownload">下载</button>
      <button class="menu-item" @click="vm.menuRename">重命名</button>
      <button class="menu-item danger" @click="vm.menuDelete">删除</button>
    </div>
  </section>
</template>
