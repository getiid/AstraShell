import { watch, type Ref } from 'vue'

type SerialForm = {
  baudRate: number
}

export function useSerialBaudSync(params: {
  serialForm: Ref<SerialForm>
  serialBaudPreset: Ref<string>
  serialBaudRates: number[]
}) {
  const {
    serialForm,
    serialBaudPreset,
    serialBaudRates,
  } = params

  watch(() => serialForm.value.baudRate, (value) => {
    const rate = Number(value || 0)
    serialBaudPreset.value = serialBaudRates.includes(rate) ? String(rate) : 'custom'
  }, { immediate: true })

  watch(serialBaudPreset, (value) => {
    if (value === 'custom') return
    const rate = Number(value || 0)
    if (Number.isFinite(rate) && rate > 0) serialForm.value.baudRate = rate
  })
}
