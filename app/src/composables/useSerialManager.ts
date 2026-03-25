import { computed, ref, type Ref } from 'vue'

type SerialDialogType = 'tx' | 'rx' | 'sys' | 'err'
type TerminalMode = 'ssh' | 'serial' | 'local'

type UseSerialManagerParams = {
  sshStatus: Ref<string>
  activeTerminalMode: Ref<TerminalMode>
  focusTerminal: Ref<boolean>
  prepareTerminal: () => Promise<void> | void
  writeTerminalLine: (text: string) => void
}

export function useSerialManager(params: UseSerialManagerParams) {
  const {
    sshStatus,
    activeTerminalMode,
    focusTerminal,
    prepareTerminal,
    writeTerminalLine,
  } = params

  const serialPortsLoaded = ref(false)
  const serialPorts = ref<any[]>([])
  const serialBaudRates = [
    50, 75, 110, 134, 150, 200, 300,
    600, 1200, 1800, 2400, 4800, 9600,
    19200, 38400, 57600, 115200, 230400,
  ]
  const serialForm = ref<{ path: string; baudRate: number; dataBits: number; stopBits: number; parity: 'none' | 'even' | 'odd' }>({
    path: '',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  })
  const serialBaudPreset = ref('9600')
  const serialSendText = ref('')
  const serialHexMode = ref(false)
  const serialTimerMs = ref(0)
  const serialFlowControl = ref<'none' | 'rtscts' | 'dsrdtr' | 'xonxoff'>('none')
  const serialAdvancedOpen = ref(false)
  const serialConnected = ref(false)
  const serialCurrentPath = ref('')
  const serialDialogLogs = ref<Array<{ id: string; ts: number; type: SerialDialogType; text: string }>>([])
  let serialTimer: number | null = null

  const serialTimerActive = computed(() => !!serialTimer)
  const serialConnectionInfo = computed(() => {
    if (!serialConnected.value || !serialCurrentPath.value) return '未连接'
    return `${serialCurrentPath.value} · ${serialForm.value.baudRate} bps`
  })

  const pushSerialDialog = (type: SerialDialogType, rawText: string) => {
    const text = String(rawText || '').replace(/\r/g, '')
    if (!text.trim()) return
    const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
    for (const line of lines) {
      serialDialogLogs.value.unshift({
        id: `serial-log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        type,
        text: line,
      })
    }
    if (serialDialogLogs.value.length > 500) {
      serialDialogLogs.value = serialDialogLogs.value.slice(0, 500)
    }
  }

  const clearSerialTimer = () => {
    if (serialTimer) {
      clearInterval(serialTimer)
      serialTimer = null
    }
  }

  const loadSerialPorts = async () => {
    serialPorts.value = await window.lightterm.listSerialPorts()
    serialPortsLoaded.value = true
    if (!serialForm.value.path && serialPorts.value.length > 0) {
      serialForm.value.path = serialPorts.value[0].path
    }
  }

  const openSerial = async () => {
    if (!serialForm.value.path) return
    clearSerialTimer()
    const res = await window.lightterm.openSerial({
      ...serialForm.value,
      rtscts: serialFlowControl.value === 'rtscts',
      dsrdtr: serialFlowControl.value === 'dsrdtr',
      xon: serialFlowControl.value === 'xonxoff',
      xoff: serialFlowControl.value === 'xonxoff',
    })
    if (!res.ok) {
      sshStatus.value = `串口打开失败：${res.error || '未知错误'}`
      pushSerialDialog('err', `连接失败：${res.error || '未知错误'}`)
      writeTerminalLine(`\r\n串口打开失败：${res.error || '未知错误'}`)
      return
    }
    serialConnected.value = true
    serialCurrentPath.value = serialForm.value.path
    activeTerminalMode.value = 'serial'
    focusTerminal.value = false
    await prepareTerminal()
    pushSerialDialog('sys', `连接成功：${serialCurrentPath.value}（${serialForm.value.baudRate} bps）`)
    sshStatus.value = `串口已连接：${serialCurrentPath.value}`
  }

  const sendSerial = async () => {
    const pathValue = serialCurrentPath.value || serialForm.value.path
    if (!pathValue || !serialSendText.value) return
    const res = await window.lightterm.sendSerial({
      path: pathValue,
      data: serialSendText.value,
      isHex: serialHexMode.value,
    })
    if (res.ok) {
      pushSerialDialog('tx', serialSendText.value)
      return
    }
    pushSerialDialog('err', `发送失败：${res.error || '未知错误'}`)
    writeTerminalLine(`\r\n发送失败：${res.error}`)
  }

  const closeSerial = async () => {
    const pathValue = serialCurrentPath.value || serialForm.value.path
    if (!pathValue) return
    clearSerialTimer()
    const res = await window.lightterm.closeSerial({ path: pathValue })
    if (res.ok) {
      serialConnected.value = false
      serialCurrentPath.value = ''
      sshStatus.value = `串口已断开：${pathValue}`
      pushSerialDialog('sys', `串口已断开：${pathValue}`)
      writeTerminalLine(`\r\n[串口已断开] ${pathValue}`)
      if (activeTerminalMode.value === 'serial') focusTerminal.value = false
      return
    }
    sshStatus.value = `串口断开失败：${res.error || '未知错误'}`
    pushSerialDialog('err', `断开失败：${res.error || '未知错误'}`)
  }

  const toggleTimerSend = () => {
    if (serialTimer) {
      clearSerialTimer()
      pushSerialDialog('sys', '已停止定时发送')
      return
    }
    if (!serialTimerMs.value || serialTimerMs.value < 50) return
    serialTimer = window.setInterval(() => void sendSerial(), serialTimerMs.value)
    pushSerialDialog('sys', `已开启定时发送：${serialTimerMs.value} ms`)
  }

  const disposeSerial = async () => {
    clearSerialTimer()
    if (serialConnected.value && serialCurrentPath.value) {
      await window.lightterm.closeSerial({ path: serialCurrentPath.value })
    }
  }

  return {
    serialPortsLoaded,
    serialPorts,
    serialBaudRates,
    serialForm,
    serialBaudPreset,
    serialSendText,
    serialHexMode,
    serialTimerMs,
    serialFlowControl,
    serialAdvancedOpen,
    serialConnected,
    serialCurrentPath,
    serialDialogLogs,
    serialTimerActive,
    serialConnectionInfo,
    pushSerialDialog,
    loadSerialPorts,
    openSerial,
    sendSerial,
    closeSerial,
    toggleTimerSend,
    clearSerialTimer,
    disposeSerial,
  }
}
