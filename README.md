# AstraShell

<img src="docs/screenshots/astrashell-banner.png" alt="AstraShell Banner" width="420" />

<img src="docs/screenshots/astrashell-icon-1024.png" alt="AstraShell Icon" width="120" />

AstraShell 是一个开源、免费、跨平台（macOS / Windows / Android）的终端工作台，聚合 SSH、SFTP、密钥仓库、代码片段、串口与版本更新能力，目标是让“连接服务器到执行运维动作”变成单一工作流。

![AstraShell 主机管理界面](docs/screenshots/dashboard-2026-03-13.svg)

## 核心能力

| 模块 | 说明 | 当前状态 |
| --- | --- | --- |
| SSH 管理台 | 分类管理主机、卡片选择/编辑分离、双击直连终端 | 已可用 |
| 终端会话 | xterm 交互、右键复制粘贴、快捷键复制粘贴 | 已可用 |
| SFTP 双栏 | 左右独立连接（本地/远程），拖拽上传下载，排序 | 已可用 |
| Windows 本地盘符 | 本地目录根层自动列出 `C:/D:/E:` 等盘符 | 已可用 |
| 密钥仓库 | 初始化/解锁主密钥，保存私钥/公钥/证书（至少填一项） | 已可用 |
| 代码片段 | 分类管理脚本，终端中可直接执行/发送原文 | 已可用 |
| 串口工具 | 端口扫描、连接、ASCII/HEX、定时发送 | 已可用 |
| 本地终端 | 本机 shell 连接、快捷命令、片段联动执行 | 已可用 |
| 操作日志 | 按服务器分组查看输入命令与终端反馈历史 | 已可用 |
| 自动更新 | GitHub Release 自动升级（Windows 自动安装，mac 提供下载升级） | 已可用 |

## 使用流程（新用户）

1. 首次启动直接初始化本地数据库并设置密钥仓库主密码。
2. 如需跨设备同步，进入“应用设置 -> 同步中心”，选择一个外部数据库文件并保存配置。
3. 进入主机页，新建 SSH 主机或导入已有主机信息。
4. 单击卡片选中，点编辑按钮改参数；双击卡片直接连接终端。
5. 进入 SFTP 页面，分别为左/右两侧选择“本地或远程”连接。
6. 在代码片段页维护常用命令，在终端工具栏直接调用执行。

## 平台说明

| 平台 | 形态 | 状态 |
| --- | --- | --- |
| macOS (Apple Silicon) | Electron Desktop | 主线版本 |
| Windows x64 | Electron Desktop (NSIS) | 已支持 |
| Android | Expo/React Native 客户端 | 已提供 APK 预览包 |
| iOS | Expo/React Native 客户端 | 开发中 |

## 本地开发

### 桌面端

```bash
cd app
npm install
npm run dev
```

### 移动端（Android/iOS 同一套代码）

```bash
cd mobile
npm install
npm run start
```

然后在 Expo DevTools 中选择：
- `a` 启动 Android 模拟器
- `i` 启动 iOS 模拟器（仅 macOS）

## 打包

### 桌面端全量打包

```bash
cd app
npm run dist
```

### 仅打 Windows 安装包

```bash
cd app
npx electron-builder --win --x64
```

## 常见问题

### 1) macOS 提示 “已损坏，无法打开”

从网络来源下载后可执行：

```bash
xattr -dr com.apple.quarantine /Applications/AstraShell.app
```

从当前版本开始，DMG 内已附带明文说明文件《AstraShell 安装说明.txt》，其中直接写明了上面的命令。

### 2) Windows 提示 `Installer integrity check has failed`

先校验安装包 SHA256，确认文件未损坏：

```powershell
Get-FileHash -Algorithm SHA256 "AstraShell Setup x.y.z.exe"
```

### 3) Windows 升级时提示卸载失败

先完全退出 AstraShell，再执行安装包；当前安装器已加入强制结束旧进程、禁用 CRC 校验与卸载兜底逻辑。

### 4) 代码片段为什么没有“同步”过来

当前不是账号云同步，也没有账号中心。
应用运行时始终读写本地数据库；跨设备共享依赖“同步中心”里指定的外部数据库文件快照。

- 本地数据库固定保存在应用目录，不再需要手动设置“本地存储”
- 建议把同步数据库文件放到 iCloud、U 盘、SMB、NAS 等可挂载位置
- 在“应用设置 -> 同步中心”中点击“新建数据库”或“选择数据库”，最后保存配置
- 同步支持启动后台下载、本地变更自动上传、立即下载、立即上传和失败重试
- 不建议多台设备同时高频写同一个同步文件

### 5) macOS 无法一键安装更新

当前公开构建尚未使用 `Developer ID Application` 证书签名，也未做 notarization。
这类构建在 macOS 上会提示手动下载安装：

- 直接从 GitHub Release 下载 `DMG`
- 手动覆盖 `/Applications/AstraShell.app`

### 6) 七牛更新源 HTTPS 校验失败

当前默认更新源仍指向 `https://astra.jitux.com`，但自定义域名证书与域名尚未完全匹配。
若自动更新检查失败，客户端会继续回退到 GitHub / Gitee。

## 项目结构

```text
AstraShell/
├─ app/            # Electron + Vue3 桌面端
├─ mobile/         # Expo React Native（Android/iOS）
├─ docs/           # 截图、发布说明
└─ 资料/            # 本地交接资料（不上传 GitHub）
```

## 发布渠道

- 仓库：<https://github.com/getiid/AstraShell>
- 安装包下载：GitHub Releases 附件（`.dmg` / `.exe` / `.apk`）
- 桌面端自动升级：GitHub Release + `latest.yml` / `latest-mac.yml`
- 当前仓库打包版本：`v0.3.10`
- 当前最新公开版本：`v0.3.10`

## 自动升级策略

- Windows：使用 GitHub Release 的 `AstraShell-Setup-x.y.z.exe` 与 `latest.yml`
- macOS：使用 GitHub Release 的 `AstraShell-x.y.z-mac.zip` 与 `latest-mac.yml`
- 当前公开 mac 构建仍未签名，因此自动检查到新版后，仍可能需要手动完成安装或去隔离
