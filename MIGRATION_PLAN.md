# AstraShell 迁移计划：Electron → Tauri

## 📋 迁移目标

1. ✅ 保留功能：SSH、SFTP、串口工具、密钥管理、代码片段、同步中心
2. ❌ 移除功能：数据库工作台、本地终端
3. 🚀 技术栈：Electron → Tauri 2.0
4. 🎨 优化 UI：简化导航、减少面板

---

## 📦 需要移除的文件清单

### 1. 数据库相关文件

**Composables:**
- `app/src/composables/databaseWorkspaceActions.ts`
- `app/src/composables/databaseWorkspaceHelpers.ts`
- `app/src/composables/databaseWorkspaceTypes.ts`
- `app/src/composables/useDatabaseWorkspace.ts`

**Components:**
- `app/src/components/panels/DatabasePanel.vue`
- `app/src/components/panels/database/` (整个目录)
  - `DatabaseVisualPanel.vue`
  - `DatabaseSnippetPicker.vue`
  - `DatabaseConnectionEditor.vue`
  - `useDatabasePanelController.ts`

**依赖包 (package.json):**
- `mysql2`
- `mssql`
- `pg`

### 2. 本地终端相关文件

**Composables:**
- `app/src/composables/useLocalTerminalManager.ts`
- `app/src/composables/useLocalQuickTools.ts`

**Components:**
- `app/src/components/panels/LocalPanel.vue`

**依赖包 (package.json):**
- `node-pty`

### 3. 需要修改的文件

**导航相关:**
- `app/src/components/AppSidebar.vue` - 移除 database 和 local 导航项
- `app/src/components/AppShell.vue` - 移除对应的路由和面板引用

**启动相关:**
- `app/src/composables/useAppStartupLifecycle.ts` - 移除数据库和本地终端初始化

**代码片段相关:**
- `app/src/composables/snippetExecution.ts` - 移除本地终端执行逻辑

---

## 🔧 迁移步骤

### 阶段 1：清理代码（1-2 天）

1. **移除数据库功能**
   - 删除数据库相关的 composables 和 components
   - 从 package.json 移除数据库依赖
   - 清理导航和路由

2. **移除本地终端功能**
   - 删除本地终端相关的 composables 和 components
   - 从 package.json 移除 node-pty
   - 清理相关引用

3. **优化 UI**
   - 简化侧边栏导航（只保留 6 个核心功能）
   - 优化布局和样式

### 阶段 2：准备 Tauri 环境（1 天）

1. **安装 Tauri CLI**
   ```bash
   cargo install tauri-cli
   npm install @tauri-apps/cli @tauri-apps/api
   ```

2. **初始化 Tauri 配置**
   ```bash
   npm run tauri init
   ```

3. **配置 tauri.conf.json**
   - 设置应用名称、版本
   - 配置窗口大小和权限
   - 设置构建选项

### 阶段 3：迁移核心功能（2-3 周）

1. **文件系统操作** → Tauri FS API
2. **SSH/SFTP** → Tauri Command (Rust 后端)
3. **串口通信** → Tauri Plugin Serial
4. **SQLite 数据库** → Tauri Plugin SQL
5. **密钥管理** → Tauri Secure Storage
6. **自动更新** → Tauri Updater

### 阶段 4：测试和优化（1 周）

1. 功能测试
2. 性能优化
3. 打包测试
4. 文档更新

---

## 📊 预期收益

| 指标 | Electron | Tauri | 改进 |
|------|----------|-------|------|
| 安装包大小 | ~120MB | ~15MB | **-87%** |
| 启动时间 | 2-3s | <1s | **-70%** |
| 内存占用 | 200MB+ | 50MB | **-75%** |
| 依赖包大小 | 592MB | ~100MB | **-83%** |

---

## ⚠️ 风险和注意事项

1. **SSH/SFTP 迁移**：需要在 Rust 中重新实现，可能需要时间
2. **串口工具**：需要使用 Tauri 的串口插件
3. **数据迁移**：确保现有用户数据兼容
4. **测试覆盖**：需要全面测试所有功能

---

## 🎯 里程碑

- [ ] **M1**: 完成代码清理（移除数据库和本地终端）
- [ ] **M2**: Tauri 环境搭建完成
- [ ] **M3**: 核心功能迁移完成（SSH、SFTP）
- [ ] **M4**: 串口和其他功能迁移完成
- [ ] **M5**: 测试通过，发布 v1.0.0-tauri

---

## 📝 下一步行动

1. 确认迁移计划
2. 开始移除数据库和本地终端代码
3. 优化 UI 和导航
4. 准备 Tauri 环境
