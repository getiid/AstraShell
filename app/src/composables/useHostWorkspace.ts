import type { Ref } from 'vue'
import { useHostCrud } from './useHostCrud'
import { useHostFilters } from './useHostFilters'
import { useHostProbe } from './useHostProbe'

type UseHostWorkspaceParams = {
  hostItems: Ref<any[]>
  extraCategories: Ref<string[]>
  selectedHostId: Ref<string>
  sshForm: Ref<any>
  quickConnectInput: Ref<string>
  hostName: Ref<string>
  hostCategory: Ref<string>
  authType: Ref<'password' | 'key'>
  selectedKeyRef: Ref<string>
  sshStatus: Ref<string>
  editingHost: Ref<any | null>
  editPasswordVisible: Ref<boolean>
  hostEditorVisible: Ref<boolean>
  hostsLoaded: Ref<boolean>
  defaultCategory: string
  allCategory: string
  notify: (ok: boolean, message: string) => void
  createSshTab: (name?: string) => string
  closeSshTab: (sessionId: string) => Promise<void>
  connectSSH: (options?: { keepNav?: boolean } | Event) => Promise<boolean>
}

export function useHostWorkspace(params: UseHostWorkspaceParams) {
  const {
    hostItems,
    extraCategories,
    selectedHostId,
    sshForm,
    quickConnectInput,
    hostName,
    hostCategory,
    authType,
    selectedKeyRef,
    sshStatus,
    editingHost,
    editPasswordVisible,
    hostEditorVisible,
    hostsLoaded,
    defaultCategory,
    allCategory,
    notify,
    createSshTab,
    closeSshTab,
    connectSSH,
  } = params

  let selectedCategoryRef: Ref<string> | null = null
  let hostCategoriesRef: Ref<string[]> | null = null
  let syncHostProbeMap = () => {}
  let probeAllHosts = async () => {}

  const refreshHosts = async (options: { probe?: boolean } = {}) => {
    const res = await window.lightterm.hostsList()
    if (!res.ok) return

    hostItems.value = res.items || []
    hostsLoaded.value = true

    if (
      selectedCategoryRef
      && hostCategoriesRef
      && !hostCategoriesRef.value.includes(selectedCategoryRef.value)
      && selectedCategoryRef.value !== allCategory
    ) {
      selectedCategoryRef.value = allCategory
    }

    syncHostProbeMap()
    if (options.probe) await probeAllHosts()
  }

  const hostFilters = useHostFilters({
    hostItems,
    extraCategories,
    defaultCategory,
    allCategory,
    notify,
    refreshHosts: async () => refreshHosts(),
  })

  selectedCategoryRef = hostFilters.selectedCategory
  hostCategoriesRef = hostFilters.hostCategories as unknown as Ref<string[]>

  const hostProbe = useHostProbe({
    hostItems,
    filteredHosts: hostFilters.filteredHosts as unknown as Ref<any[]>,
  })

  syncHostProbeMap = hostProbe.syncHostProbeMap
  probeAllHosts = hostProbe.probeAllHosts

  const connectHostTerminal = async (host: any) => {
    const tabId = createSshTab((host?.name || host?.host || '新会话').trim())
    const ok = await connectSSH()
    if (!ok) await closeSshTab(tabId)
  }

  const hostCrud = useHostCrud({
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
    refreshHosts: async () => refreshHosts(),
    connectHostTerminal,
  })

  return {
    refreshHosts,
    ...hostFilters,
    ...hostProbe,
    ...hostCrud,
  }
}
