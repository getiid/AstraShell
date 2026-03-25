<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel serial-panel">
    <div class="serial-connect-shell">
      <div class="serial-connect-card">
        <div class="serial-title">
          <span class="serial-title-icon">⌨</span>
          <h3>串口连接</h3>
        </div>
        <div class="serial-route-line">
          <span>端口</span>
          <i></i>
          <span>会话</span>
        </div>
        <div class="serial-form-stack">
          <label class="serial-field-label">端口选择</label>
          <select v-model="vm.serialForm.value.path">
            <option value="">请选择串口端口</option>
            <option v-for="p in vm.serialPorts.value" :key="p.path" :value="p.path">{{ p.path }}</option>
          </select>
          <label class="serial-field-label">波特率选择</label>
          <div class="serial-baud-row">
            <select v-model="vm.serialBaudPreset.value">
              <option v-for="rate in vm.serialBaudRates" :key="`baud-preset-${rate}`" :value="String(rate)">{{ rate }} bps</option>
              <option value="custom">自定义输入</option>
            </select>
            <input v-model.number="vm.serialForm.value.baudRate" type="number" min="1" step="1" placeholder="手动输入波特率" />
          </div>
          <button class="serial-advanced-toggle ghost" @click="vm.serialAdvancedOpen.value = !vm.serialAdvancedOpen.value">
            高级参数 {{ vm.serialAdvancedOpen.value ? '▾' : '▸' }}
          </button>
          <div v-if="vm.serialAdvancedOpen.value" class="serial-advanced-panel">
            <label>字符编码</label>
            <select v-model="vm.terminalEncoding.value">
              <option value="utf-8">UTF-8（推荐）</option>
              <option value="gb18030">GB18030（中文设备）</option>
            </select>

            <label>数据位</label>
            <div class="serial-segment">
              <button class="seg-btn" :class="{ active: vm.serialForm.value.dataBits === 8 }" @click="vm.serialForm.value.dataBits = 8">8</button>
              <button class="seg-btn" :class="{ active: vm.serialForm.value.dataBits === 7 }" @click="vm.serialForm.value.dataBits = 7">7</button>
              <button class="seg-btn" :class="{ active: vm.serialForm.value.dataBits === 6 }" @click="vm.serialForm.value.dataBits = 6">6</button>
              <button class="seg-btn" :class="{ active: vm.serialForm.value.dataBits === 5 }" @click="vm.serialForm.value.dataBits = 5">5</button>
            </div>

            <label>停止位</label>
            <div class="serial-segment">
              <button class="seg-btn" :class="{ active: vm.serialForm.value.stopBits === 1 }" @click="vm.serialForm.value.stopBits = 1">1</button>
              <button class="seg-btn" :class="{ active: vm.serialForm.value.stopBits === 2 }" @click="vm.serialForm.value.stopBits = 2">2</button>
            </div>

            <label>流控</label>
            <div class="serial-segment flow">
              <button class="seg-btn" :class="{ active: vm.serialFlowControl.value === 'none' }" @click="vm.serialFlowControl.value = 'none'">无</button>
              <button class="seg-btn" :class="{ active: vm.serialFlowControl.value === 'rtscts' }" @click="vm.serialFlowControl.value = 'rtscts'">RTS/CTS</button>
              <button class="seg-btn" :class="{ active: vm.serialFlowControl.value === 'dsrdtr' }" @click="vm.serialFlowControl.value = 'dsrdtr'">DSR/DTR</button>
              <button class="seg-btn" :class="{ active: vm.serialFlowControl.value === 'xonxoff' }" @click="vm.serialFlowControl.value = 'xonxoff'">XON/XOFF</button>
            </div>

            <label>校验位</label>
            <div class="serial-segment">
              <button class="seg-btn" :class="{ active: vm.serialForm.value.parity === 'none' }" @click="vm.serialForm.value.parity = 'none'">无</button>
              <button class="seg-btn" :class="{ active: vm.serialForm.value.parity === 'odd' }" @click="vm.serialForm.value.parity = 'odd'">奇校验</button>
              <button class="seg-btn" :class="{ active: vm.serialForm.value.parity === 'even' }" @click="vm.serialForm.value.parity = 'even'">偶校验</button>
            </div>
          </div>
          <label class="serial-field-label">发送内容</label>
          <input v-model="vm.serialSendText.value" :placeholder="vm.serialHexMode.value ? 'HEX 示例：41 54 0D 0A' : '输入要发送的内容'" />
          <div class="serial-send-toolbar">
            <label class="serial-inline-check"><input v-model="vm.serialHexMode.value" type="checkbox" /> HEX 模式</label>
            <input v-model.number="vm.serialTimerMs.value" type="number" min="50" step="10" placeholder="定时发送 ms（>=50）" />
          </div>
          <div class="serial-send-actions">
            <button :disabled="!vm.serialConnected.value" @click="vm.sendSerial">发送</button>
            <button
              class="muted"
              :disabled="!vm.serialConnected.value || !vm.serialTimerMs.value || vm.serialTimerMs.value < 50"
              @click="vm.toggleTimerSend"
            >
              {{ vm.serialTimerActive.value ? '停止定时' : '开启定时' }}
            </button>
          </div>
        </div>
        <div class="serial-connect-actions">
          <button class="muted" @click="vm.loadSerialPorts">刷新端口</button>
          <button v-if="!vm.serialConnected.value" class="serial-connect-btn" @click="vm.openSerial">连接串口</button>
          <button v-else class="danger" @click="vm.closeSerial">断开串口</button>
        </div>
      </div>
      <div class="serial-dialog-panel">
        <div class="serial-dialog-info">
          <div class="serial-dialog-info-title">连接信息</div>
          <div class="serial-dialog-info-main">{{ vm.serialConnected.value ? '已连接' : '未连接' }}</div>
          <div class="serial-dialog-info-sub">{{ vm.serialConnectionInfo.value }}</div>
        </div>
        <div class="serial-dialog-list">
          <article v-for="item in vm.serialDialogLogs.value" :key="item.id" class="serial-dialog-item" :class="`type-${item.type}`">
            <header>
              <span>{{ item.type === 'tx' ? '发送' : item.type === 'rx' ? '接收' : item.type === 'err' ? '错误' : '状态' }}</span>
              <small>{{ vm.formatAuditTime(item.ts) }}</small>
            </header>
            <pre>{{ item.text }}</pre>
          </article>
          <div v-if="vm.serialDialogLogs.value.length === 0" class="file-row empty">连接后这里将显示串口交互内容</div>
        </div>
      </div>
    </div>
  </section>
</template>
