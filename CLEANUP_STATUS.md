# 代码清理状态报告

## 📊 清理进度：约 70% 完成

### ✅ 已完成的工作

1. **删除的文件：**
   - `app/src/components/panels/DatabasePanel.vue`
   - `app/src/components/panels/LocalPanel.vue`
   - `app/src/components/panels/database/` (整个目录)
   - `app/src/composables/databaseWorkspaceActions.ts`
   - `app/src/composables/databaseWorkspaceHelpers.ts`
   - `app/src/composables/databaseWorkspaceTypes.ts`
   - `app/src/composables/useDatabaseWorkspace.ts`
   - `app/src/composables/useLocalTerminalManager.ts`
   - `app/src/composables/useLocalQuickTools.ts`

2. **已更新的文件：**
   - ✅ `app/package.json` - 移除了 mysql2、mssql、pg、node-pty 依赖
   - ✅ `app/src/components/AppSidebar.vue` - 移除了 database 和 local 导航项
   - ✅ `app/src/components/AppShell.vue` - 移除了面板引用
   - ✅ `app/src/components/useAppShellController.ts` - 移除了大部分引用
   - ✅ `app/src/components/useAppShellViewModelBundle.ts` - 移除了 ViewModel 引用
   - ✅ `app/src/components/appShellWorkspaceVms.ts` - 移除了面板 VM
   - ✅ `app/src/components/appShellNavigation.ts` - 移除了本地终端导航
   - ✅ `app/src/components/appShellChromeVms.ts` - 移除了状态引用
   - ✅ `app/src/components/appShellTerminalVm.ts` - 移除了本地终端 VM
   - ✅ `app/src/composables/snippetManagerTypes.ts` - 本地终端参数改为可选
   - ✅ `app/src/composables/terminalRuntimeTypes.ts` - 本地终端参数改为可选
   - ⚠️ `app/src/composables/snippetExecution.ts` - 部分清理完成
   - ⚠️ `app/src/composables/useSnippetManager.ts` - 部分清理完成

### ⚠️ 还需要完成的工作

#### 1. useTerminalRuntime.ts（高优先级）
**文件：** `app/src/composables/useTerminalRuntime.ts`

**需要修改的地方：**
- 第 25-36 行：移除 localConnected、activeLocalSessionId、localStatus 等参数的解构
- 第 56 行：移除 localStatus 的引用
- 第 81-88 行：移除本地终端写入逻辑
- 第 91-98 行：移除 syncLocalTerminalSize 函数
- 第 127 行：移除 recordLocalInput 调用
- 第 175-192 行：移除本地终端数据处理逻辑
- 第 207、222 行：移除 renderActiveLocalSession 调用
- 第 235-236 行：移除返回值中的本地终端引用

**修改策略：**
```typescript
// 移除所有 activeTerminalMode.value === 'local' 的分支
// 只保留 'ssh' 和 'serial' 两种模式
```

#### 2. TerminalWorkspace.vue（中优先级）
**文件：** `app/src/components/TerminalWorkspace.vue`

**需要修改的地方：**
- 第 63-68 行：移除本地终端模式工具栏
- 第 70-91 行：移除本地终端标签页
- 移除所有 `vm.localTabs`、`vm.activeLocalTabId` 等引用

#### 3. useAppShellLifecycleServices.ts（中优先级）
**文件：** `app/src/composables/useAppShellLifecycleServices.ts`

**需要修改的地方：**
- 移除 localConnected、localCwd、connectLocalTerminal 参数
- 移除 disconnectAllLocalTabs 调用
- 移除本地终端初始化逻辑

#### 4. Electron 主进程（低优先级）
**文件：** `app/electron/main.mjs` 或相关文件

**需要修改的地方：**
- 移除 `localWrite`、`localResize`、`localClose` 等 IPC 处理器
- 移除 node-pty 相关的导入和逻辑

#### 5. 其他小修复
- 移除 `useSnippetManager.ts` 中残留的 `executeSnippetOnLocalTerminal` 引用（第 255 行）
- 清理所有 TypeScript 类型错误

---

## 🔧 快速完成清理的步骤

### 方案 A：我继续完成（推荐）
我会继续系统地完成所有剩余的清理工作，预计还需要 20-30 分钟。

### 方案 B：你自己完成
按照上面的清单，你可以手动完成剩余的清理工作。主要是：
1. 清理 `useTerminalRuntime.ts` 中的所有本地终端逻辑
2. 清理 `TerminalWorkspace.vue` 中的本地终端 UI
3. 运行 `npm install` 移除旧依赖
4. 运行 `npm run typecheck` 修复所有类型错误

### 方案 C：分阶段提交
我们可以先提交当前的进度（标记为 WIP），然后继续完成剩余工作。

---

## 📝 下一步建议

1. **完成代码清理**（还需 20-30 分钟）
2. **运行 `npm install`** 移除旧依赖
3. **运行 `npm run typecheck`** 确保没有类型错误
4. **运行 `npm run dev`** 测试应用是否正常启动
5. **测试核心功能**：SSH、SFTP、串口、代码片段
6. **提交清理工作**
7. **开始 Tauri 迁移**（这是一个更大的工程）

---

## ⚠️ 注意事项

- 清理工作比预期复杂，因为本地终端功能深度集成在代码中
- 建议完成清理后先测试 Electron 版本，确保所有功能正常
- Tauri 迁移是一个独立的大工程，建议单独规划

---

生成时间：2026-05-04
