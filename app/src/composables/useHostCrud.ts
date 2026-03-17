import { formatQuickConnectValue, parseQuickConnectInput } from '../utils/quickConnect'
import type { Ref } from 'vue'

const DEFAULT_CATEGORY = '默认'

const createEmptyHostEditor = () => ({
  id: '',
  name: '',
  host: '',
  port: 22,
  username: 'root',
  password: '',
  category: DEFAULT_CATEGORY,
  authType: 'password',
  privateKeyRef: '',
  purchaseDate: '',
  expiryDate: '',
})

export function useHostCrud(params: {
  sshForm: Ref<any>
  quickConnectInput: Ref<string>
  selectedHostId: Ref<string>
  hostItems: Ref<any[]>
  hostName: Ref<string>
  hostCategory: Ref<string>
  authType: Ref<'password' | 'key'>
  selectedKeyRef: Ref<string>
  sshStatus: Ref<string>
  editingHost: Ref<any>
  editPasswordVisible: Ref<boolean>
  hostEditorVisible: Ref<boolean>
  notify: (ok: boolean, msg: string) => void
  refreshHosts: () => Promise<void>
  connectHostTerminal: (h: any) => Promise<void>
}) {
  const {
    sshForm,
    quickConnectInput,
    selectedHostId,
    hostItems,
    hostName,
    hostCategory,
    authType,
    selectedKeyRef,
    sshStatus,
    editingHost,
    editPasswordVisible,
    hostEditorVisible,
    notify,
    refreshHosts,
    connectHostTerminal,
  } = params

  const syncQuickConnectForm = () => {
    const parsed = parseQuickConnectInput(quickConnectInput.value)
    if (!parsed.ok) {
      sshStatus.value = parsed.error
      return false
    }
    const selectedHost = hostItems.value.find((item) => item.id === selectedHostId.value)
    const selectedTarget = selectedHost ? formatQuickConnectValue(selectedHost) : ''
    sshForm.value.host = parsed.host
    sshForm.value.port = parsed.port
    sshForm.value.username = parsed.username
    if (selectedHost && quickConnectInput.value.trim() === selectedTarget) {
      hostName.value = selectedHost.name || `${parsed.username}@${parsed.host}`
      hostCategory.value = selectedHost.category || DEFAULT_CATEGORY
      authType.value = selectedHost.auth_type === 'key' ? 'key' : 'password'
      selectedKeyRef.value = selectedHost.private_key_ref || ''
    } else {
      selectedHostId.value = ''
      hostName.value = `${parsed.username}@${parsed.host}`
      hostCategory.value = DEFAULT_CATEGORY
      authType.value = 'password'
      selectedKeyRef.value = ''
    }
    return true
  }

  const saveCurrentHost = async () => {
    if (!syncQuickConnectForm()) return
    const res = await window.lightterm.hostsSave({
      name: hostName.value || sshForm.value.host,
      category: hostCategory.value || DEFAULT_CATEGORY,
      ...sshForm.value,
      authType: authType.value,
      privateKeyRef: selectedKeyRef.value || null,
    })
    if (res.ok) {
      await refreshHosts()
      notify(true, '主机已保存')
    } else {
      notify(false, `主机保存失败：${res.error || '未知错误'}`)
    }
  }

  const useHost = (h: any) => {
    selectedHostId.value = h.id
    sshForm.value.host = h.host
    sshForm.value.port = h.port
    sshForm.value.username = h.username
    sshForm.value.password = h.password || ''
    quickConnectInput.value = formatQuickConnectValue(h)
    hostName.value = h.name
    hostCategory.value = h.category || DEFAULT_CATEGORY
    authType.value = h.auth_type === 'key' ? 'key' : 'password'
    selectedKeyRef.value = h.private_key_ref || ''
  }

  const openHostEditor = (h: any) => {
    useHost(h)
    editPasswordVisible.value = false
    editingHost.value = {
      id: h.id,
      name: h.name,
      host: h.host,
      port: h.port,
      username: h.username,
      password: h.password || '',
      category: h.category || DEFAULT_CATEGORY,
      authType: h.auth_type || 'password',
      privateKeyRef: h.private_key_ref || '',
      purchaseDate: h.purchaseDate || '',
      expiryDate: h.expiryDate || '',
    }
    hostEditorVisible.value = true
  }

  const openCreateHostEditor = () => {
    selectedHostId.value = ''
    hostEditorVisible.value = true
    editPasswordVisible.value = false
    editingHost.value = createEmptyHostEditor()
  }

  const openHostTerminal = async (h: any) => {
    useHost(h)
    await connectHostTerminal(h)
  }

  const saveEditedHost = async () => {
    if (!editingHost.value) return
    const h = editingHost.value
    const res = await window.lightterm.hostsSave({
      id: h.id || undefined,
      name: h.name,
      host: h.host,
      port: Number(h.port || 22),
      username: h.username,
      password: h.password || '',
      category: h.category || DEFAULT_CATEGORY,
      authType: h.authType || 'password',
      privateKeyRef: h.privateKeyRef || null,
      purchaseDate: h.purchaseDate || '',
      expiryDate: h.expiryDate || '',
    })
    if (res.ok) {
      await refreshHosts()
      notify(true, '主机参数已更新')
    } else {
      notify(false, `更新失败：${res.error || '未知错误'}`)
    }
  }

  const deleteCurrentHost = async () => {
    if (!selectedHostId.value) return
    await window.lightterm.hostsDelete({ id: selectedHostId.value })
    selectedHostId.value = ''
    editingHost.value = null
    hostEditorVisible.value = false
    await refreshHosts()
    sshStatus.value = '主机已删除'
  }

  return {
    syncQuickConnectForm,
    saveCurrentHost,
    useHost,
    openHostEditor,
    openCreateHostEditor,
    openHostTerminal,
    saveEditedHost,
    deleteCurrentHost,
  }
}
