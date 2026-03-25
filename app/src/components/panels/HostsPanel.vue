<script setup lang="ts">
import { Pencil, Eye, EyeOff } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel hosts-panel">
    <div class="hosts-header">
      <div>
        <h3>主机管理</h3>
        <p class="hosts-header-sub">快速筛选主机并在右侧编辑详情</p>
      </div>
      <div class="hosts-quick-connect">
        <input
          v-model="vm.quickConnectInput.value"
          placeholder="SSH 快速连接，例如 root@1.2.3.4 或 admin@1.2.3.4:22"
          @keyup.enter="vm.connectSSHFromHosts"
        />
        <button class="ghost small" @click="vm.saveCurrentHost">保存</button>
        <button class="muted small" @click="vm.connectSSHFromHosts">连接</button>
      </div>
    </div>

    <div class="hosts-layout new-layout">
      <div class="hosts-left">
        <div class="hosts-left-title">
          <span>分类</span>
          <button class="ghost tiny" @click="vm.beginAddCategory">+ 新建</button>
        </div>
        <div v-if="vm.newCategoryInputVisible.value" class="cat-item input-item">
          <input
            v-model="vm.newCategoryName.value"
            placeholder="输入分类名后回车"
            @keyup.enter="vm.addCategory"
            @blur="vm.addCategory"
          />
        </div>
        <div
          v-for="c in vm.displayCategories.value"
          :key="c"
          class="cat-item"
          :class="{ activeCat: vm.selectedCategory.value === c }"
        >
          <button class="cat-name" @click="vm.selectedCategory.value = c">{{ c }}</button>
          <button
            v-if="c !== vm.defaultCategory && c !== vm.allCategory"
            class="icon-btn"
            @click="vm.renameCategoryInline(c)"
          >
            <Pencil :size="12" />
          </button>
        </div>
      </div>

      <div class="hosts-center">
        <div class="hosts-toolbar">
          <input v-model="vm.hostKeyword.value" placeholder="搜索主机 / IP / 用户名" />
          <button class="ghost tiny" :disabled="vm.hostProbeRunning.value || vm.filteredHosts.value.length === 0" @click="vm.probeFilteredHosts">
            {{ vm.hostProbeRunning.value ? '检测中...' : '检测当前列表' }}
          </button>
          <button class="muted tiny" @click="vm.openCreateHostEditor">新建服务器</button>
          <span class="hosts-stat">显示 {{ vm.filteredHosts.value.length }} / {{ vm.hostItems.value.length }} 台主机</span>
        </div>
        <div class="host-grid">
          <div
            v-for="h in vm.filteredHosts.value"
            :key="h.id"
            class="host-card"
            :class="{ activeHost: vm.selectedHostId.value === h.id }"
            @click="vm.useHost(h)"
            @dblclick="vm.openHostTerminal(h)"
          >
            <div class="host-card-main">
              <span class="host-icon">{{ h.auth_type === 'key' ? '🔑' : '🖥' }}</span>
              <div class="host-card-body">
                <div class="host-card-title">{{ h.name }}</div>
                <div class="host-line">{{ h.host }} · {{ h.username }}</div>
              </div>
            </div>
            <div class="host-card-meta">
              <span class="pill ghost">{{ h.auth_type === 'key' ? '密钥' : '密码' }}</span>
              <button class="status-dot-btn" :title="vm.hostProbeTitle(h)" @click.stop="vm.testHostReachability(h)">
                <span class="status-dot" :class="vm.hostProbeClass(h.id)"></span>
              </button>
              <button class="host-edit-btn" title="编辑主机" @click.stop="vm.openHostEditor(h)">
                <Pencil :size="12" />
              </button>
            </div>
          </div>
          <div v-if="vm.filteredHosts.value.length === 0" class="file-row empty">暂无主机</div>
        </div>
      </div>

      <div class="hosts-editor-column" :class="{ visible: vm.hostEditorVisible.value }">
        <div v-if="vm.hostEditorVisible.value" class="host-editor-panel">
          <div class="editor-title">
            <Pencil :size="14" /> SSH 编辑
            <button class="ghost small" @click="vm.hostEditorVisible.value = false">收起</button>
          </div>
          <div v-if="vm.editingHost.value" class="ssh-edit-zone">
            <div class="ssh-edit-grid">
              <div class="ssh-module">
                <div class="module-title">基础信息</div>
                <input v-model="vm.editingHost.value.name" placeholder="连接名称" />
                <select v-model="vm.editingHost.value.category">
                  <option v-for="c in vm.hostCategories.value" :key="c" :value="c">{{ c }}</option>
                </select>
                <input v-model="vm.editingHost.value.host" placeholder="主机/IP" />
                <input v-model.number="vm.editingHost.value.port" type="number" placeholder="端口" />
                <input v-model="vm.editingHost.value.username" placeholder="用户名" />
              </div>
              <div class="ssh-module">
                <div class="module-title">认证</div>
                <select v-model="vm.editingHost.value.authType">
                  <option value="password">密码认证</option>
                  <option value="key">密钥认证</option>
                </select>
                <div v-if="vm.editingHost.value.authType === 'password'" class="password-field">
                  <input
                    v-model="vm.editingHost.value.password"
                    :type="vm.editPasswordVisible.value ? 'text' : 'password'"
                    placeholder="密码"
                  />
                  <button
                    class="icon-btn password-toggle"
                    type="button"
                    :title="vm.editPasswordVisible.value ? '隐藏密码' : '显示密码'"
                    @click="vm.editPasswordVisible.value = !vm.editPasswordVisible.value"
                  >
                    <EyeOff v-if="vm.editPasswordVisible.value" :size="14" />
                    <Eye v-else :size="14" />
                  </button>
                </div>
                <select v-else v-model="vm.editingHost.value.privateKeyRef">
                  <option value="">选择密钥</option>
                  <option v-for="k in vm.vaultItems.value" :key="k.id" :value="k.id">{{ k.name }} ({{ k.type }})</option>
                </select>
              </div>
            </div>
            <div class="ssh-edit-grid">
              <div class="ssh-module">
                <div class="module-title">资产信息</div>
                <label>购买日期</label>
                <input v-model="vm.editingHost.value.purchaseDate" type="date" />
                <label>有效期</label>
                <input v-model="vm.editingHost.value.expiryDate" type="date" />
              </div>
              <div class="ssh-module">
                <div class="module-title">操作</div>
                <div class="ssh-actions">
                  <button @click="vm.saveEditedHost">保存修改</button>
                  <button class="muted" @click="vm.openHostTerminal(vm.editingHost.value)">连接终端</button>
                  <button
                    class="danger"
                    @click="vm.selectedHostId.value = vm.editingHost.value.id; vm.deleteCurrentHost()"
                  >
                    删除主机
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-tip">先在中间选择一个 SSH 条目进行编辑</div>
        </div>
      </div>
    </div>
  </section>
</template>
