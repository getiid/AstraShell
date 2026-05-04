<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <div v-if="vm.startupGateVisible.value" class="startup-overlay">
    <div class="startup-card">
      <h3>正在准备本地数据库...</h3>
      <p>应用启动后固定使用本地数据库运行；如果启用了同步，会在进入后后台检查远端数据库文件。</p>
      <p class="hint">当前数据文件：{{ vm.storageDbPath.value || vm.startupDbPath.value || '读取中...' }}</p>
      <p class="vault-status">{{ vm.startupGateError.value || vm.plainVaultMessage(vm.vaultStatus.value) || '就绪' }}</p>

      <div v-if="vm.startupGateMode.value === 'init'" class="startup-form">
        <input
          v-model="vm.vaultMaster.value"
          type="password"
          placeholder="设置主密码"
          :disabled="vm.startupGateBusy.value"
        />
        <input
          v-model="vm.startupMasterConfirm.value"
          type="password"
          placeholder="再次输入主密码"
          :disabled="vm.startupGateBusy.value"
        />
        <button class="primary" :disabled="vm.startupGateBusy.value" @click="vm.runStartupInit">
          {{ vm.startupGateBusy.value ? '初始化中...' : '初始化并进入' }}
        </button>
      </div>

      <div v-else-if="vm.startupGateMode.value === 'unlock'" class="startup-form">
        <input
          v-model="vm.vaultMaster.value"
          type="password"
          placeholder="输入主密码"
          :disabled="vm.startupGateBusy.value"
          @keydown.enter="vm.runStartupUnlock"
        />
        <button class="primary" :disabled="vm.startupGateBusy.value" @click="vm.runStartupUnlock">
          {{ vm.startupGateBusy.value ? '解锁中...' : '解锁并进入' }}
        </button>
      </div>
    </div>
  </div>
</template>
