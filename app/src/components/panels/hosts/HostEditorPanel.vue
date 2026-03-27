<script setup lang="ts">
import { Eye, EyeOff, Pencil } from 'lucide-vue-next'
import type { Ref } from 'vue'

defineProps<{
  hostEditorVisible: Ref<boolean>
  editingHost: Ref<any | null>
  hostCategories: Ref<string[]>
  editPasswordVisible: Ref<boolean>
  vaultItems: Ref<any[]>
  saveEditedHost: () => void | Promise<void>
  saveDateFieldIfExisting: () => Promise<void>
}>()
</script>

<template>
  <aside class="hosts-editor-column" :class="{ visible: hostEditorVisible.value }">
    <div v-if="hostEditorVisible.value" class="host-editor-panel">
      <div class="editor-title">
        <div class="editor-title-main">
          <Pencil :size="14" />
          <div>
            <strong>{{ editingHost.value?.id ? '编辑 SSH 主机' : '新建 SSH 主机' }}</strong>
            <small>右侧保持参数完整，左侧随时可以继续切换主机。</small>
          </div>
        </div>
        <div class="editor-title-actions">
          <button class="small" @click="saveEditedHost">保存</button>
          <button class="ghost small" @click="hostEditorVisible.value = false">收起</button>
        </div>
      </div>
      <div v-if="editingHost.value" class="ssh-edit-zone">
        <div class="ssh-edit-grid">
          <div class="ssh-module">
            <div class="module-title">基础信息</div>
            <input v-model="editingHost.value.name" placeholder="连接名称" />
            <select v-model="editingHost.value.category">
              <option v-for="c in hostCategories.value" :key="c" :value="c">{{ c }}</option>
            </select>
            <input v-model="editingHost.value.host" placeholder="主机/IP" />
            <div class="ssh-inline-grid">
              <input v-model.number="editingHost.value.port" type="number" placeholder="端口" />
              <input v-model="editingHost.value.username" placeholder="用户名" />
            </div>
          </div>

          <div class="ssh-module">
            <div class="module-title">认证方式</div>
            <select v-model="editingHost.value.authType">
              <option value="password">密码认证</option>
              <option value="key">密钥认证</option>
            </select>
            <div v-if="editingHost.value.authType === 'password'" class="password-field">
              <input
                v-model="editingHost.value.password"
                :type="editPasswordVisible.value ? 'text' : 'password'"
                placeholder="密码"
              />
              <button
                class="icon-btn password-toggle"
                type="button"
                :title="editPasswordVisible.value ? '隐藏密码' : '显示密码'"
                @click="editPasswordVisible.value = !editPasswordVisible.value"
              >
                <EyeOff v-if="editPasswordVisible.value" :size="14" />
                <Eye v-else :size="14" />
              </button>
            </div>
            <select v-else v-model="editingHost.value.privateKeyRef">
              <option value="">选择密钥</option>
              <option v-for="k in vaultItems.value" :key="k.id" :value="k.id">{{ k.name }} ({{ k.type }})</option>
            </select>
          </div>
        </div>

        <div class="ssh-edit-grid">
          <div class="ssh-module">
            <div class="module-title">资产信息</div>
            <label>购买日期</label>
            <input v-model="editingHost.value.purchaseDate" type="date" @change="saveDateFieldIfExisting" />
            <label>有效期</label>
            <input v-model="editingHost.value.expiryDate" type="date" @change="saveDateFieldIfExisting" />
          </div>
        </div>
      </div>
      <div v-else class="empty-tip">先在中间选择一个 SSH 条目进行编辑</div>
    </div>
  </aside>
</template>
