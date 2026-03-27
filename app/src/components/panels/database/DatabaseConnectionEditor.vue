<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'

defineProps<{
  editorVisible: boolean
  editorMode: 'create' | 'edit'
  editorSaving: boolean
  editorError: string
  passwordVisible: boolean
  editorForm: {
    name: string
    engine: string
    host: string
    port: number
    username: string
    password: string
    database: string
    note: string
  }
  engineOptions: string[]
  handleEngineChange: () => void
  closeEditor: () => void
  submitEditor: () => void | Promise<void>
}>()

const emit = defineEmits<{
  (event: 'update:passwordVisible', value: boolean): void
}>()
</script>

<template>
  <div v-if="editorVisible" class="database-editor-overlay" @click.self="closeEditor">
    <section class="database-editor-panel">
      <div class="editor-title">
        <div class="editor-title-main">
          <strong>{{ editorMode === 'create' ? '新建数据库连接' : '编辑数据库连接' }}</strong>
          <small>填写连接参数后保存，后续可直接在左侧连接、断开、查表和执行 SQL。</small>
        </div>
        <div class="editor-title-actions">
          <button class="ghost tiny" :disabled="editorSaving" @click="closeEditor">关闭</button>
        </div>
      </div>

      <div class="database-editor-form">
        <label class="field">
          <span>连接名称</span>
          <input v-model.trim="editorForm.name" placeholder="例如：订单主库" />
        </label>
        <label class="field">
          <span>数据库类型</span>
          <select v-model="editorForm.engine" @change="handleEngineChange">
            <option v-for="engine in engineOptions" :key="engine" :value="engine">{{ engine }}</option>
          </select>
        </label>
        <label class="field">
          <span>主机地址</span>
          <input v-model.trim="editorForm.host" placeholder="127.0.0.1" />
        </label>
        <label class="field">
          <span>端口</span>
          <input v-model.number="editorForm.port" type="number" min="1" placeholder="3306" />
        </label>
        <label class="field">
          <span>用户名</span>
          <input v-model.trim="editorForm.username" placeholder="root / postgres / sa" />
        </label>
        <label class="field">
          <span>密码</span>
          <div class="password-field">
            <input v-model="editorForm.password" :type="passwordVisible ? 'text' : 'password'" placeholder="可留空" />
            <button
              class="icon-btn password-toggle"
              type="button"
              :title="passwordVisible ? '隐藏密码' : '显示密码'"
              @click="emit('update:passwordVisible', !passwordVisible)"
            >
              <EyeOff v-if="passwordVisible" :size="14" />
              <Eye v-else :size="14" />
            </button>
          </div>
        </label>
        <label class="field">
          <span>默认数据库 / Schema</span>
          <input v-model.trim="editorForm.database" placeholder="可留空" />
        </label>
        <label class="field span-2">
          <span>备注</span>
          <textarea v-model.trim="editorForm.note" rows="3" placeholder="例如：生产只读、报表环境、测试联调"></textarea>
        </label>
      </div>
      <div v-if="editorError" class="database-editor-error">{{ editorError }}</div>

      <div class="database-editor-actions">
        <button class="ghost tiny" :disabled="editorSaving" @click="closeEditor">取消</button>
        <button class="muted tiny" :disabled="editorSaving" @click="submitEditor">
          {{ editorSaving ? '保存中...' : '保存' }}
        </button>
      </div>
    </section>
  </div>
</template>
