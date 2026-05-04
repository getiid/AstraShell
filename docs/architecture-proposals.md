# AstraShell 多终端架构方案

## 当前架构分析

### 现状
- **桌面端**：Electron + Vue 3 + xterm.js
- **移动端**：Expo + React Native（原型阶段）
- **同步**：文件级数据库同步

### 问题
1. 桌面端（Vue 3）和移动端（React Native）技术栈分裂，代码无法共享
2. 文件同步体验差，容易冲突
3. 移动端功能实现受限（SSH、串口、数据库连接等）
4. Electron 打包体积大（~100MB+）

---

## 方案对比

| 方案 | 代码共享率 | 开发成本 | 功能完整性 | 包体积 | 推荐度 |
|------|-----------|---------|-----------|--------|--------|
| 方案1: Tauri + Capacitor | 85% | 中 | 桌面完整/移动受限 | 小 | ⭐⭐⭐⭐⭐ |
| 方案2: 现状 + 云同步 | 0% | 低 | 完整 | 大 | ⭐⭐⭐ |
| 方案3: Web + PWA | 95% | 高 | 受限 | 最小 | ⭐⭐ |
| 方案4: Flutter 重写 | 100% | 最高 | 完整 | 中 | ⭐ |

---

## 方案 1：Tauri + Capacitor（推荐）⭐

### 架构设计

```
┌─────────────────────────────────────────────────────┐
│              Shared Vue 3 Codebase                  │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ UI 组件  │  │ 组合函数 │  │  业务逻辑       │  │
│  │ (85%共享)│  │ (80%共享)│  │  (数据处理)     │  │
│  └──────────┘  └──────────┘  └─────────────────┘  │
└─────────────┬───────────────────────────┬───────────┘
              │                           │
       ┌──────▼──────┐             ┌──────▼──────┐
       │   Tauri     │             │  Capacitor  │
       │  Desktop    │             │   Mobile    │
       └──────┬──────┘             └──────┬──────┘
              │                           │
       ┌──────▼──────┐             ┌──────▼──────┐
       │ Rust Backend│             │Native Bridge│
       │ • SSH (ssh2)│             │ • 有限功能  │
       │ • 串口      │             │ • Web SSH   │
       │ • 本地终端  │             │ • 只读操作  │
       │ • 数据库    │             │             │
       └─────────────┘             └─────────────┘
```

### 目录结构

```
AstraShell/
├── packages/
│   ├── shared/                    # 共享 Vue 3 代码
│   │   ├── src/
│   │   │   ├── components/        # UI 组件（85% 共享）
│   │   │   ├── composables/       # 组合式函数（80% 共享）
│   │   │   ├── utils/             # 工具函数（100% 共享）
│   │   │   └── types/             # 类型定义（100% 共享）
│   │   └── package.json
│   ├── desktop-tauri/             # Tauri 桌面端
│   │   ├── src-tauri/             # Rust 后端
│   │   │   ├── src/
│   │   │   │   ├── ssh.rs         # SSH 模块
│   │   │   │   ├── sftp.rs        # SFTP 模块
│   │   │   │   ├── database.rs    # 数据库模块
│   │   │   │   └── serial.rs      # 串口模块
│   │   │   └── Cargo.toml
│   │   ├── src/                   # 前端入口（调用 shared）
│   │   └── package.json
│   └── mobile-capacitor/          # Capacitor 移动端
│       ├── src/                   # 前端入口（调用 shared）
│       ├── ios/                   # iOS 原生
│       ├── android/               # Android 原生
│       └── package.json
├── app/                           # 旧 Electron 版本（保留）
└── mobile/                        # 旧 RN 版本（保留）
```

### 技术栈映射

| 功能 | Electron (旧) | Tauri (新) |
|------|---------------|------------|
| SSH | Node.js `ssh2` | Rust `async-ssh2-tokio` |
| SFTP | Node.js `ssh2` | Rust `async-ssh2-tokio` |
| 本地终端 | Node.js `node-pty` | Rust `portable-pty` |
| 串口 | Node.js `serialport` | Rust `serialport` |
| 数据库 | Node.js `better-sqlite3` | Rust `rusqlite` |
| 终端渲染 | xterm.js | xterm.js (不变) |
| 前端 | Vue 3 | Vue 3 (不变) |

### 迁移路径

#### Phase 1: 代码重组（2 周）

```bash
# 1. 创建 monorepo 结构
mkdir packages
cd packages

# 2. 提取共享代码
mkdir -p shared/src
cp -r ../app/src/components shared/src/
cp -r ../app/src/composables shared/src/
cp -r ../app/src/utils shared/src/
cp -r ../app/src/styles shared/src/

# 3. 调整导入路径
# 将 @/components -> @astrashell/shared/components
```

#### Phase 2: Tauri 桌面端（3 个月）

```bash
# 1. 初始化 Tauri 项目
npm create tauri-app@latest

# 2. 迁移 IPC 模块
# Electron IPC -> Tauri Commands

# 示例：SSH 命令
#[tauri::command]
async fn ssh_connect(
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
) -> Result<String, String> {
    // Rust SSH 实现
}

# 3. 替换 preload.js
# 前端直接调用 Tauri API
import { invoke } from '@tauri-apps/api/core'
await invoke('ssh_connect', { host, port, username, auth })
```

#### Phase 3: Capacitor 移动端（2 个月）

```bash
# 1. 初始化 Capacitor 项目
npm install @capacitor/core @capacitor/cli
npx cap init

# 2. 添加平台
npx cap add ios
npx cap add android

# 3. 功能裁剪
# 移动端只实现：
# - 主机列表查看
# - 代码片段执行（通过 Web SSH）
# - 日志查看
# - 设置同步
```

### 优势
1. **代码共享 85%**：所有 Vue 组件和组合式函数复用
2. **包体积减小 10 倍**：Tauri 打包 ~10MB vs Electron ~100MB
3. **性能提升**：Rust 后端比 Node.js 快 2-5 倍
4. **技术栈统一**：Vue 3 全端复用
5. **安全性更好**：Tauri 默认安全配置更严格

### 劣势
1. **学习曲线**：需要学习基础 Rust
2. **生态较新**：部分库不如 Node.js 成熟
3. **移动端受限**：原生 SSH 难度大，需要妥协方案

### 成本估算
- **开发时间**：5 个月（2 周重组 + 3 月桌面 + 2 月移动）
- **人力**：1 名全栈工程师
- **风险**：中等（Tauri 和 Capacitor 都相对成熟）

---

## 方案 2：现状 + 云同步增强

### 架构设计

```
┌──────────────┐         ┌──────────────┐
│ Electron App │         │  RN Mobile   │
│  (Vue 3)     │         │  (React)     │
│  ↕ SQLite    │         │  ↕ Storage   │
└──────┬───────┘         └──────┬───────┘
       │                        │
       └────────┬───────────────┘
                │
         ┌──────▼──────┐
         │  Sync Layer │
         │  (可选)     │
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼────┐ ┌───▼────┐ ┌────▼───┐
│Supabase│ │自建API │ │ iCloud │
│(推荐)  │ │(高级)  │ │(iOS专)│
└────────┘ └────────┘ └────────┘
```

### 改进点

#### 1. 同步体验优化

**现状问题**：
- 用户需要手动选择外部数据库文件
- 多设备同时写容易冲突
- 无自动冲突检测

**改进方案**：
```typescript
// composables/useCloudSync.ts
export function useCloudSync() {
  const syncMode = ref<'local-only' | 'cloud-backup' | 'realtime'>('local-only')
  
  // 1. 本地优先同步
  const syncToCloud = async () => {
    const localDb = await getLocalDatabase()
    const changes = await getChangesSinceLastSync()
    
    // 增量同步，不是全量替换
    await supabase
      .from('sync_log')
      .upsert(changes)
  }
  
  // 2. 冲突检测
  const detectConflicts = async () => {
    const local = await getLocalVersion()
    const remote = await getRemoteVersion()
    
    if (local.timestamp < remote.timestamp) {
      return { hasConflict: true, resolution: 'merge' }
    }
  }
  
  // 3. 自动合并策略
  const mergeStrategy = {
    hosts: 'last-write-wins',
    snippets: 'merge-by-id',
    vault: 'manual-resolve'  // 敏感数据手动
  }
}
```

#### 2. 移动端重新定位

**不追求功能对等，专注 3 个核心场景**：

```typescript
// mobile/App.tsx
const MobileApp = () => {
  return (
    <NavigationContainer>
      <Tab.Navigator>
        {/* 场景1: 快速查看 */}
        <Tab.Screen name="Hosts" component={HostListScreen} />
        <Tab.Screen name="Status" component={ServerStatusScreen} />
        
        {/* 场景2: 执行预定义片段 */}
        <Tab.Screen name="Snippets" component={SnippetRunnerScreen} />
        
        {/* 场景3: 查看日志 */}
        <Tab.Screen name="Logs" component={LogViewerScreen} />
        
        {/* 不实现：完整 SSH、SFTP、数据库 */}
      </Tab.Navigator>
    </NavigationContainer>
  )
}
```

#### 3. 代码片段云化（优先级最高）

代码片段是最适合同步的数据，优先实现：

```typescript
// composables/useSnippetCloud.ts
export function useSnippetCloud() {
  // 方案A: 使用 GitHub Gist（免费）
  const syncToGist = async (snippet: Snippet) => {
    const gist = await octokit.gists.create({
      description: snippet.name,
      public: false,
      files: {
        [`${snippet.id}.sh`]: {
          content: snippet.content
        }
      }
    })
    
    return gist.data.id
  }
  
  // 方案B: 使用 Supabase（推荐）
  const syncToSupabase = async (snippet: Snippet) => {
    const { data, error } = await supabase
      .from('snippets')
      .upsert({
        id: snippet.id,
        user_id: auth.user.id,
        name: snippet.name,
        content: snippet.content,
        category: snippet.category,
        updated_at: new Date()
      })
  }
}
```

### 优势
1. **无需重构**：保持现有架构
2. **渐进式改进**：可以分步实施
3. **用户可选**：不强制云同步
4. **成本低**：Supabase 免费额度够用

### 劣势
1. **代码无法共享**：桌面和移动端仍需独立开发
2. **开发效率低**：每个功能需要实现两次
3. **维护成本高**：两套代码库

### 成本估算
- **开发时间**：2 个月
- **运维成本**：$0-25/月（Supabase）

---

## 方案 3：纯 Web 应用 + PWA

### 架构设计

```
┌────────────────────────────────┐
│      Vue 3 Web 应用            │
│   托管在 Vercel/Cloudflare     │
└────────┬───────────────────────┘
         │
    ┌────┼─────┐
    │    │     │
┌───▼┐ ┌─▼──┐ ┌▼────┐
│桌面│ │浏览│ │移动  │
│壳  │ │器  │ │PWA  │
└─┬──┘ └────┘ └─────┘
  │
┌─▼─────────────┐
│ Local Agent   │  (需要本地 SSH 等功能时)
│ (Go/Rust)     │
│ WebSocket API │
└───────────────┘
```

### 关键限制
- ❌ Web 无法直接访问 SSH、串口、本地文件系统
- ❌ 需要本地 Agent 提供能力，复杂度高
- ✅ 代码共享率最高（95%+）

### 不推荐理由
AstraShell 的核心价值在于**直接的系统级能力访问**，Web 架构会失去这个优势。

---

## 决策建议

### 如果你看重开发效率和长期维护 → 选择方案 1（Tauri + Capacitor）

**理由**：
1. 代码共享率 85%，节省大量开发时间
2. Tauri 生态快速成熟，已有大量生产案例
3. 技术栈统一，降低心智负担
4. 包体积小，用户体验更好

**投入产出比**：
- 初期投入 5 个月
- 后续每个新功能节省 60-70% 开发时间
- 6-12 个月后开始回本

### 如果你想快速改进现状 → 选择方案 2（云同步增强）

**理由**：
1. 无需重构，风险低
2. 可以先实现代码片段云化（2 周）
3. 移动端降低期望，专注核心场景

**投入产出比**：
- 2 周完成代码片段云化
- 2 个月完成完整云同步
- 立即见效

### 如果你想完全重新设计 → 考虑 Flutter

**Flutter 优势**：
- 100% 代码共享（桌面 + 移动）
- 原生性能
- 统一 UI

**Flutter 劣势**：
- 需要重写所有代码（6-12 个月）
- SSH、串口等需要写 Platform Channel
- 学习曲线陡峭

---

## 实施建议

### 推荐路径：渐进式迁移到 Tauri

```
Timeline:

Week 1-2:  代码重组，创建 shared 包
           └─ 风险：低，可回滚

Month 1-3: Tauri 桌面端开发
           ├─ Month 1: 核心 IPC（SSH、SFTP）
           ├─ Month 2: 数据库、串口、本地终端
           └─ Month 3: 打磨、测试、迁移数据
           └─ 风险：中，保留 Electron 版本作为备份

Month 4-5: Capacitor 移动端开发
           ├─ Month 4: 核心功能（主机、片段、日志）
           └─ Month 5: Web SSH 集成、测试
           └─ 风险：低，移动端是新增功能

Month 6+:  发布、收集反馈、迭代
```

### 技术验证（1 周 POC）

在决策前，建议先做技术验证：

```bash
# 1. Tauri SSH POC
cargo new tauri-ssh-poc
# 验证 Rust 的 async-ssh2-tokio 是否满足需求

# 2. 代码共享 POC
# 验证 Vue 组件在 Tauri 和 Capacitor 中的兼容性

# 3. 数据迁移 POC
# 验证 better-sqlite3 数据库可以无缝迁移到 rusqlite
```

---

## 参考资源

### Tauri
- 官方文档：https://tauri.app
- SSH 示例：https://github.com/tauri-apps/tauri/discussions/4768
- 串口示例：https://github.com/tauri-apps/tauri/discussions/3592

### Capacitor
- 官方文档：https://capacitorjs.com
- Vue 3 集成：https://capacitorjs.com/docs/getting-started/with-vue

### Supabase
- 官方文档：https://supabase.com/docs
- Realtime 订阅：https://supabase.com/docs/guides/realtime

---

## 结论

**对于 AstraShell，推荐方案 1（Tauri + Capacitor）**，因为：

1. ✅ 符合"个人运维工具"定位
2. ✅ 代码共享带来的长期收益远超初期投入
3. ✅ Tauri 生态已足够成熟，风险可控
4. ✅ 技术栈统一降低维护成本
5. ✅ 用户体验更好（包体积小、性能好）

**实施顺序**：
1. **立即**：优化现有同步体验（2 周）
2. **短期**：代码片段云化（2 周）
3. **中期**：迁移到 Tauri（3 个月）
4. **长期**：添加 Capacitor 移动端（2 个月）

这样既能快速改善用户体验，又能为长期发展奠定基础。
