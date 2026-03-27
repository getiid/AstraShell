import type { Ref } from 'vue'
import type { SnippetItem, TerminalMode } from './snippetTypes'

export type UseSnippetManagerParams = {
  hostItems: Ref<any[]>
  sshForm: Ref<{ host: string; port: number; username: string }>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  activeTerminalMode: Ref<TerminalMode>
  serialConnected: Ref<boolean>
  serialCurrentPath: Ref<string>
  localConnected: Readonly<Ref<boolean>>
  activeLocalSessionId: Readonly<Ref<string>>
  recordLocalInput: (sessionId: string, data: string) => void
  useHost: (host: any) => void
  connectSSH: (options?: { keepNav?: boolean } | Event) => Promise<boolean>
  focusTerminal: () => void
  defaultCategory?: string
  allCategory?: string
  legacyStorageKey?: string
}

export type SnippetCategoryState = {
  snippetItems: Ref<SnippetItem[]>
  snippetCategory: Ref<string>
  localSnippetCategory: Ref<string>
  terminalSnippetCategory: Ref<string>
  snippetEdit: Ref<SnippetItem>
  snippetExtraCategories: Ref<string[]>
  newSnippetCategoryName: Ref<string>
  newSnippetCategoryInputVisible: Ref<boolean>
  editingSnippetCategory: Ref<string>
  editingSnippetCategoryName: Ref<string>
  snippetStatus: Ref<string>
}
