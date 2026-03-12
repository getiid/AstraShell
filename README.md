# LightTerm

LightTerm 是一个 **中文桌面终端工具**（Mac-first），设计目标是提供接近 Termius 的使用体验：

- SSH 终端会话
- SFTP 文件管理
- 串口连接与发送面板
- 本地密钥仓库（私钥/公钥/证书）

> 当前仓库以源码为主，打包产物通过 GitHub Releases 分发。

---

## 功能截图

### SSH 管理台（三栏布局）

![LightTerm SSH 管理台](docs/screenshots/ssh-dashboard.jpg)

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

- `app/release/mac-arm64/LightTerm.app`

---

## Release 分发说明

本仓库不提交以下构建产物：

- `app/node_modules`
- `app/dist`
- `app/release`

打包后的 `.app`/`.zip` 通过 **GitHub Releases 附件**发布。

---

## 路线图

- [x] Mac 可用版（SSH/SFTP/串口/密钥仓库）
- [ ] UI 继续向 Termius 风格精修
- [ ] Windows 打包与适配
- [ ] Linux 打包与适配
- [ ] 多端同步策略优化（本地共享目录模式）

---

## 仓库

- GitHub: https://github.com/getiid/LightTerm
