<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <div v-if="vm.startupGateVisible.value" class="startup-overlay">
    <div class="startup-card">
      <h3 v-if="vm.startupGateMode.value === 'loading'">正在检查密钥仓库...</h3>
      <template v-else-if="vm.startupGateMode.value === 'init'">
        <h3>首次启动：初始化本地数据库与主密码</h3>
        <p>本地数据库会自动保存在应用目录中，你只需要设置主密码即可完成初始化。</p>
        <p class="hint">当前数据文件：{{ vm.storageDbPath.value || vm.startupDbPath.value || '读取中...' }}</p>
        <div class="grid startup-auth-grid">
          <input v-model="vm.vaultMaster.value" type="password" placeholder="设置主密码" />
          <input v-model="vm.startupMasterConfirm.value" type="password" placeholder="确认主密码" />
        </div>
        <button :disabled="vm.startupGateBusy.value" @click="vm.runStartupInit">创建并初始化</button>
      </template>
      <template v-else>
        <h3>解锁数据文件</h3>
        <p>进入软件前请先输入主密码。</p>
        <p class="hint">当前数据文件：{{ vm.storageDbPath.value || vm.startupDbPath.value || '读取中...' }}</p>
        <div class="grid startup-auth-grid">
          <input v-model="vm.vaultMaster.value" type="password" placeholder="输入主密码" @keyup.enter="vm.runStartupUnlock" />
          <button :disabled="vm.startupGateBusy.value" @click="vm.runStartupUnlock">解锁并进入</button>
        </div>
      </template>
      <p class="vault-status">{{ vm.startupGateError.value || vm.plainVaultMessage(vm.vaultStatus.value) || '就绪' }}</p>
    </div>
  </div>
</template>
