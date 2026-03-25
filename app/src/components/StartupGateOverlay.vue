<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <div v-if="vm.startupGateVisible.value" class="startup-overlay">
    <div class="startup-card">
      <h3 v-if="vm.startupGateMode.value === 'loading'">正在检查密钥仓库...</h3>
      <template v-else-if="vm.startupGateMode.value === 'select'">
        <h3>选择数据文件</h3>
        <p>安装完成后，请先决定是初始化一个新数据库，还是直接使用已有数据库文件。</p>
        <div class="grid startup-db-grid">
          <input v-model="vm.startupDbPath.value" placeholder="数据路径（可选目录或 .json/.db 文件）" />
          <button class="muted" :disabled="vm.startupGateBusy.value" @click="vm.pickStartupDbPath">打开已有文件</button>
          <button class="muted" :disabled="vm.startupGateBusy.value" @click="vm.pickStartupDbFolder">选择目录</button>
          <button class="ghost" :disabled="vm.startupGateBusy.value" @click="vm.useCurrentDbPath">使用当前路径</button>
        </div>
        <div class="grid startup-auth-grid">
          <button class="muted" :disabled="vm.startupGateBusy.value" @click="vm.beginStartupInit">初始化新数据库</button>
          <button :disabled="vm.startupGateBusy.value" @click="vm.runUseExistingStorage">使用已有数据库</button>
        </div>
      </template>
      <template v-else-if="vm.startupGateMode.value === 'init'">
        <h3>首次启动：初始化数据文件与密码</h3>
        <p>请先确定数据文件路径，然后设置主密码完成初始化。</p>
        <div class="grid startup-db-grid">
          <input v-model="vm.startupDbPath.value" placeholder="数据路径（可选目录或 .json/.db 文件）" />
          <button class="muted" :disabled="vm.startupGateBusy.value" @click="vm.pickStartupDbSavePath">新建文件</button>
          <button class="muted" :disabled="vm.startupGateBusy.value" @click="vm.pickStartupDbFolder">选择目录</button>
          <button class="ghost" :disabled="vm.startupGateBusy.value" @click="vm.useCurrentDbPath">使用当前路径</button>
        </div>
        <p class="hint">当前数据文件：{{ vm.storageDbPath.value || '读取中...' }}</p>
        <div class="grid startup-auth-grid">
          <input v-model="vm.vaultMaster.value" type="password" placeholder="设置主密码" />
          <input v-model="vm.startupMasterConfirm.value" type="password" placeholder="确认主密码" />
        </div>
        <button :disabled="vm.startupGateBusy.value" @click="vm.runStartupInit">创建并初始化</button>
      </template>
      <template v-else>
        <h3>解锁数据文件</h3>
        <p>进入软件前请先输入主密码。</p>
        <p class="hint">当前数据文件：{{ vm.storageDbPath.value || '读取中...' }}</p>
        <div class="grid startup-auth-grid">
          <input v-model="vm.vaultMaster.value" type="password" placeholder="输入主密码" @keyup.enter="vm.runStartupUnlock" />
          <button :disabled="vm.startupGateBusy.value" @click="vm.runStartupUnlock">解锁并进入</button>
        </div>
      </template>
      <p class="vault-status">{{ vm.startupGateError.value || vm.plainVaultMessage(vm.vaultStatus.value) || '就绪' }}</p>
    </div>
  </div>
</template>
