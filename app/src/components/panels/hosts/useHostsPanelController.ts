import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const WARNING_DAYS = 15
const DAY_MS = 24 * 60 * 60 * 1000

export const useHostsPanelController = (vm: any) => {
  const totalHosts = computed(() => vm.hostItems.value.length)
  const filteredHostsCount = computed(() => vm.filteredHosts.value.length)
  const selectedHost = computed(() => vm.hostItems.value.find((item: any) => item.id === vm.selectedHostId.value) || null)
  const currentCategoryLabel = computed(() => (vm.selectedCategory.value === vm.allCategory ? '全部主机' : vm.selectedCategory.value))
  const secondaryCategories = computed(() =>
    vm.displayCategories.value.filter((category: string) => category !== vm.allCategory && category !== vm.defaultCategory)
  )

  const hostCategoryMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    category: '',
  })

  const countByCategory = (category: string) => {
    if (category === vm.allCategory) return vm.hostItems.value.length
    return vm.hostItems.value.filter((item: any) => (item.category || vm.defaultCategory) === category).length
  }

  const authLabel = (item: any) => ((item?.auth_type || item?.authType) === 'key' ? '密钥' : '密码')
  const getHostExpiryDate = (item: any) => String(item?.expiryDate || item?.expiry_date || '').trim()

  const probeLabel = (item: any) => {
    const state = vm.hostProbeClass(item.id)
    if (state === 'online') return '在线可连'
    if (state === 'offline') return '当前不可达'
    if (state === 'checking') return '正在检测'
    return '待检测'
  }

  const parseDateOnly = (value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return null
    const date = new Date(`${raw}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const daysUntilExpiry = (value: string) => {
    const expiry = parseDateOnly(value)
    if (!expiry) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.ceil((expiry.getTime() - today.getTime()) / DAY_MS)
  }

  const expiryText = (days: number | null) => {
    if (days == null) return '未设置到期'
    if (days < 0) return `已过期 ${Math.abs(days)} 天`
    if (days === 0) return '今天到期'
    return `还有 ${days} 天到期`
  }

  const expiringHosts = computed(() =>
    vm.hostItems.value
      .map((item: any) => {
        const days = daysUntilExpiry(getHostExpiryDate(item))
        return { item, days }
      })
      .filter(({ days }: { days: number | null }) => days != null && days <= WARNING_DAYS)
      .sort((a: { days: number | null }, b: { days: number | null }) => Number(a.days) - Number(b.days))
  )

  const jumpToExpiringHost = (item: any) => {
    vm.useHost(item)
    vm.openHostEditor(item)
  }

  const saveDateFieldIfExisting = async () => {
    if (!vm.editingHost.value?.id) return
    await vm.saveEditedHost()
  }

  const closeHostCategoryMenu = () => {
    hostCategoryMenu.value.visible = false
  }

  const openHostCategoryMenu = (event: MouseEvent, category: string) => {
    if (!category || category === vm.defaultCategory || category === vm.allCategory) return
    event.preventDefault()
    hostCategoryMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      category,
    }
  }

  const renameHostCategoryFromMenu = () => {
    const category = hostCategoryMenu.value.category
    closeHostCategoryMenu()
    vm.beginRenameCategory(category)
  }

  const deleteHostCategoryFromMenu = () => {
    const category = hostCategoryMenu.value.category
    closeHostCategoryMenu()
    vm.deleteCategoryInline(category)
  }

  onMounted(() => {
    window.addEventListener('click', closeHostCategoryMenu)
    window.addEventListener('resize', closeHostCategoryMenu)
    window.addEventListener('scroll', closeHostCategoryMenu, true)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('click', closeHostCategoryMenu)
    window.removeEventListener('resize', closeHostCategoryMenu)
    window.removeEventListener('scroll', closeHostCategoryMenu, true)
  })

  return {
    WARNING_DAYS,
    totalHosts,
    filteredHostsCount,
    selectedHost,
    currentCategoryLabel,
    secondaryCategories,
    hostCategoryMenu,
    countByCategory,
    authLabel,
    getHostExpiryDate,
    probeLabel,
    daysUntilExpiry,
    expiryText,
    expiringHosts,
    jumpToExpiringHost,
    saveDateFieldIfExisting,
    openHostCategoryMenu,
    renameHostCategoryFromMenu,
    deleteHostCategoryFromMenu,
  }
}
