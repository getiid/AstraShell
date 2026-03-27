export type SnippetItem = {
  id: string
  name: string
  category: string
  hostId: string
  description: string
  commands: string
  reminderDate: string
  lastRunAt: number
  lastRunStatus: 'idle' | 'running' | 'success' | 'error'
  lastRunOutput: string
  createdAt: number
  updatedAt: number
}

export type LegacyQuickToolItem = {
  id: string
  category: string
  label: string
  cmd: string
  updatedAt?: number
}

export type TerminalMode = 'ssh' | 'serial' | 'local'
