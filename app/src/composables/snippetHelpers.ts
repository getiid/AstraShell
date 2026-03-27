import type { SnippetItem } from './snippetTypes'

const WARNING_DAYS = 15
const DAY_MS = 24 * 60 * 60 * 1000

export const createEmptySnippet = (defaultCategory: string): SnippetItem => ({
  id: '',
  name: '',
  category: defaultCategory,
  hostId: '',
  description: '',
  commands: '',
  reminderDate: '',
  lastRunAt: 0,
  lastRunStatus: 'idle',
  lastRunOutput: '',
  createdAt: 0,
  updatedAt: 0,
})

export const filterSnippetItems = (
  items: SnippetItem[],
  category: string,
  allCategory: string,
  keyword: string,
) => {
  const normalizedKeyword = keyword.trim().toLowerCase()
  return items
    .filter((item) => {
      const inCategory = category === allCategory || item.category === category
      if (!inCategory) return false
      if (!normalizedKeyword) return true
      return [item.name, item.description, item.commands]
        .some((value) => String(value || '').toLowerCase().includes(normalizedKeyword))
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export const formatSnippetRunTime = (value: number) => {
  if (!value) return '未执行'
  const date = new Date(value)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  const ss = `${date.getSeconds()}`.padStart(2, '0')
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}`
}

export const snippetLastRunLabel = (item: SnippetItem) => {
  if (!item?.lastRunAt) return '未执行'
  if (item.lastRunStatus === 'success') return `成功 · ${formatSnippetRunTime(item.lastRunAt)}`
  if (item.lastRunStatus === 'error') return `失败 · ${formatSnippetRunTime(item.lastRunAt)}`
  if (item.lastRunStatus === 'running') return '执行中...'
  return formatSnippetRunTime(item.lastRunAt)
}

export const snippetListRunLabel = (item: SnippetItem) => {
  if (!item?.lastRunAt) return '未执行'
  if (item.lastRunStatus === 'success') return '成功'
  if (item.lastRunStatus === 'error') return '失败'
  if (item.lastRunStatus === 'running') return '执行中'
  return '已执行'
}

export const snippetLastRunTone = (item: SnippetItem) => item?.lastRunStatus || 'idle'

const parseDateOnly = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return null
  const date = new Date(`${raw}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export const normalizeReminderDate = (value: string) => {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !!parseDateOnly(raw) ? raw : ''
}

export const daysUntilReminder = (value: string) => {
  const reminder = parseDateOnly(value)
  if (!reminder) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((reminder.getTime() - today.getTime()) / DAY_MS)
}

export const snippetReminderDate = (item: SnippetItem) => normalizeReminderDate(item?.reminderDate || '')

export const snippetReminderDays = (item: SnippetItem) => daysUntilReminder(snippetReminderDate(item))

export const snippetReminderLabel = (item: SnippetItem) => {
  const reminderDate = snippetReminderDate(item)
  if (!reminderDate) return '未设提醒'
  const days = snippetReminderDays(item)
  if (days == null) return reminderDate
  if (days < 0) return `已超出 ${Math.abs(days)} 天`
  if (days === 0) return '今天提醒'
  if (days <= WARNING_DAYS) return `还有 ${days} 天提醒`
  return `提醒 ${reminderDate}`
}

export const snippetReminderTone = (item: SnippetItem) => {
  const reminderDate = snippetReminderDate(item)
  if (!reminderDate) return 'idle'
  const days = snippetReminderDays(item)
  if (days == null) return 'idle'
  if (days <= 3) return 'danger'
  if (days <= WARNING_DAYS) return 'warning'
  return 'quiet'
}

export const buildDefaultDockerSnippet = (defaultCategory: string): SnippetItem => ({
  id: `snippet-${Date.now().toString(36)}-docker`,
  name: '部署 Docker（Debian/Ubuntu）',
  category: defaultCategory,
  hostId: '',
  description: '安装 Docker CE、启动服务并加入当前用户组。',
  commands: [
    'sudo apt-get update',
    'sudo apt-get install -y ca-certificates curl gnupg',
    'sudo install -m 0755 -d /etc/apt/keyrings',
    'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
    'sudo chmod a+r /etc/apt/keyrings/docker.gpg',
    'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
    'sudo apt-get update',
    'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
    'sudo systemctl enable docker --now',
    'sudo usermod -aG docker $USER',
    'docker --version',
  ].join('\n'),
  reminderDate: '',
  lastRunAt: 0,
  lastRunStatus: 'idle',
  lastRunOutput: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

export const snippetCommandLines = (commands: string) => (
  commands
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !!line && !line.startsWith('#'))
)

export const snippetLineCount = (commands: string) => {
  const raw = String(commands || '')
  if (!raw.trim()) return 0
  return raw.split('\n').length
}
