# AstraShell

AstraShell 是一个 **中文桌面终端工具**（Mac-first），设计目标是提供接近 Termius 的使用体验：

- SSH 终端会话
- SFTP 文件管理
- 串口连接与发送面板
- 本地密钥仓库（私钥/公钥/证书）

> 当前仓库以源码为主，打包产物通过 GitHub Releases 分发。

---

## 功能截图

### SSH 管理台（三栏布局）

![AstraShell SSH 管理台](docs/screenshots/ssh-dashboard.jpg)

## 功能概览

### 1) SSH
- 连接测试（带超时反馈）
- 真实终端交互（xterm）
- 会话列表与快速连接
- 主机分类/搜索/编辑

### 2) SFTP
- 远程目录读取
- 上传 / 下载
- 新建目录 / 重命名 / 删除
- 传输进度显示

### 3) 串口
- 串口扫描与打开
- ASCII / HEX 发送
- 定时发送

### 4) 密钥仓库
- 主密码初始化/解锁/重置
- 自动识别密钥格式（OpenSSH / PEM / PPK）
- 保存密钥组：
  - Private Key
  - Public Key
  - Certificate

### 5) 主机工作区（当前 UI）
- 左：分类
- 中：SSH 列表
- 右：SSH 参数编辑（可收起）
- 单击列表项编辑，双击直接进入终端

---

## 技术栈

- Electron
- Vue 3 + TypeScript + Vite
- xterm.js
- ssh2 / serialport / sshpk

---

## 本地开发

```bash
cd app
npm install
npm run dev
```

---

## 本地构建

```bash
cd app
npm run build
```

---

## 打包（macOS）

```bash
cd app
npx electron-builder --mac --dir -c.mac.identity=null -c.mac.hardenedRuntime=false -c.mac.gatekeeperAssess=false
```

产物示例：

- `app/release/mac-arm64/AstraShell.app`

首次从压缩包或网络来源运行时，如果 macOS 提示损坏或无法打开，可在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/AstraShell.app
```

---

## Release 分发说明

本仓库不提交以下构建产物：

- `app/node_modules`
- `app/dist`
- `app/release`

打包后的 `.app`/`.zip` 通过 **GitHub Releases 附件**发布。

---

## 当前开发进度（2026-03）

> 这一段是“继续开发前必看”，用来快速知道现在做到哪里。

### 已完成（可用）

- [x] Electron + Vue3 + TS 基础工程可运行
- [x] SSH：连接测试、终端交互（xterm）
- [x] 主机管理：保存 / 编辑 / 删除 / 搜索
- [x] 主机三栏工作区（左分类 / 中列表 / 右编辑）
- [x] SFTP：读取、上传、下载、重命名、删除、新建目录
- [x] 串口：端口扫描、连接、ASCII/HEX 发送、定时发送
- [x] 密钥仓库：初始化、解锁、重置、密钥导入与保存
- [x] 本地构建通过（`npm run build`）

### 正在进行

- [ ] SSH 工作区交互细节打磨（列表与编辑体验）
- [ ] UI 统一（间距、层级、密度、Termius 风格细化）

### 下一步（按优先级）

1. SSH 面板微调（你每次提的交互都落文档）
2. SFTP 双栏体验优化（批量操作/状态反馈）
3. 密钥仓库与主机绑定流程再简化
4. 打包与发布流程固化（Release Checklist）
5. Windows / Linux 适配

---

## 研发协作约定（建议）

为了避免“改着改着不知道到哪了”，后续每次改动都按下面更新：

1. **改 README 的“当前开发进度”**（勾选已完成项）
2. 在 `TODO.v1.md` 追加“本轮迭代”条目
3. 每个里程碑打一个 git commit（信息明确）

推荐提交信息格式：

- `feat(ssh): ...`
- `feat(sftp): ...`
- `refactor(ui): ...`
- `fix(vault): ...`

---

## 快速启动（开发）

```bash
cd app
npm install
npm run dev
```

## 快速构建（本地）

```bash
cd app
npm run build
```

---

## 仓库

- GitHub: https://github.com/getiid/LightTerm
