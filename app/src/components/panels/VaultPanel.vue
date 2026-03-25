<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()

const formatVaultDate = (value: string | number | null | undefined) => {
  if (!value) return '未更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未更新'
  return date.toLocaleDateString()
}
</script>

<template>
  <section class="panel vault-panel">
    <div class="vault-header">
      <h3>密钥管理</h3>
      <div class="vault-toolbar">
        <input v-model="vm.vaultMaster.value" type="password" placeholder="主密码" />
        <button v-if="!vm.vaultInitialized.value" @click="vm.initVault">初始化仓库</button>
        <button v-else @click="vm.unlockVault">解锁仓库</button>
        <button class="muted" @click="vm.refreshVaultKeys">刷新密钥列表</button>
        <button class="danger" @click="vm.resetVault">重置仓库</button>
      </div>
      <p class="vault-status">
        {{ vm.vaultStatus.value }} ｜ bridge={{ vm.bridgeReady.value ? 'ok' : 'missing' }} ｜ initialized={{ vm.vaultInitialized.value }} unlocked={{ vm.vaultUnlocked.value }}
      </p>
    </div>

    <div class="vault-layout">
      <div class="vault-list">
        <div class="vault-list-head">
          <input v-model="vm.vaultKeyword.value" placeholder="搜索密钥名/类型/指纹" />
          <button class="ghost small" @click="vm.clearVaultEditor">新建密钥</button>
        </div>
        <div class="vault-card-grid">
          <button
            v-for="k in vm.filteredVaultItems.value"
            :key="k.id"
            class="vault-mini-card"
            :class="{ active: vm.selectedVaultKeyId.value === k.id }"
            @click="vm.openVaultEditor(k)"
          >
            <div class="vault-mini-head">
              <span class="vault-mini-title">{{ k.name }}</span>
              <span class="pill ghost">{{ k.type }}</span>
            </div>
            <div class="vault-mini-fp">{{ k.fingerprint || '无指纹' }}</div>
            <div class="vault-mini-time">{{ formatVaultDate(k.updated_at) }}</div>
          </button>
          <div v-if="vm.filteredVaultItems.value.length === 0" class="file-row empty">暂无密钥数据</div>
        </div>
      </div>

      <div class="vault-editor-column" :class="{ visible: vm.vaultEditorVisible.value }">
        <div class="vault-editor-panel">
          <div class="editor-title">
            <KeyRound :size="14" /> 密钥编辑
            <button class="ghost small" @click="vm.clearVaultEditor">清空</button>
          </div>
          <div class="vault-form-grid">
            <input v-model="vm.vaultKeyName.value" placeholder="密钥名称" />
            <select v-model="vm.vaultKeyType.value">
              <option value="auto">自动识别</option>
              <option value="openssh">OpenSSH</option>
              <option value="pem">PEM</option>
              <option value="ppk">PPK</option>
              <option value="public">Public</option>
              <option value="certificate">Certificate</option>
              <option value="bundle">Bundle</option>
            </select>
            <textarea v-model="vm.vaultPrivateKey.value" class="key-input" placeholder="Private Key（可选）"></textarea>
            <textarea v-model="vm.vaultPublicKey.value" class="key-input" placeholder="Public Key（可选）"></textarea>
            <textarea v-model="vm.vaultCertificate.value" class="key-input" placeholder="Certificate（可选）"></textarea>
            <p class="hint">私钥/公钥/证书三项至少填写一项即可保存。</p>
            <div class="vault-actions">
              <button class="ghost" @click="vm.importVaultKeyFile">导入文件</button>
              <button @click="vm.saveVaultKey">{{ vm.selectedVaultKeyId.value ? '保存修改' : '保存密钥组' }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
