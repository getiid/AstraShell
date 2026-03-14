# AstraShell

![AstraShell Logo](docs/screenshots/astrashell-logo.svg)

AstraShell 是一个面向中文用户的桌面运维终端，聚合 SSH、SFTP、密钥仓库、代码片段、串口与版本更新能力，目标是让“连接服务器到执行运维动作”变成单一工作流。

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
| 自动更新 | 七牛 -> GitHub -> Gitee 多源检查更新 | 已可用 |

## 使用流程（新用户）

1. 首次启动先选择数据库位置并初始化密钥仓库。
2. 进入主机页，新建 SSH 主机或导入已有主机信息。
3. 单击卡片选中，点编辑按钮改参数；双击卡片直接连接终端。
4. 进入 SFTP 页面，分别为左/右两侧选择“本地或远程”连接。
5. 在代码片段页维护常用命令，在终端工具栏直接调用执行。

## 平台说明

| 平台 | 形态 | 状态 |
| --- | --- | --- |
| macOS (Apple Silicon) | Electron Desktop | 主线版本 |
| Windows x64 | Electron Desktop (NSIS) | 已支持 |
| Android | Expo/React Native 客户端 | 开发中 |
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

从 `0.3.0` 开始，DMG 内已附带 `AstraShell Repair.command`，拖入应用后可直接双击修复。

### 2) Windows 提示 `Installer integrity check has failed`

先校验安装包 SHA256，确认文件未损坏：

```powershell
Get-FileHash -Algorithm SHA256 "AstraShell Setup x.y.z.exe"
```

### 3) Windows 升级时提示卸载失败

先完全退出 AstraShell，再执行安装包；当前安装器已加入强制结束旧进程、禁用 CRC 校验与卸载兜底逻辑。

### 4) 代码片段为什么没有“同步”过来

当前不是云同步，也没有账号中心。
跨设备共享依赖同一个共享目录里的 `lightterm.db` 文件；这个文件当前是 JSON 数据文件，不是远端数据库。

- 两台设备都要在“应用设置 -> 本地存储”里选到同一个云盘/共享目录
- 改完目录后重启应用
- 不要两台设备同时写入同一个文件

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
- 桌面端安装包：GitHub Releases 附件（`.dmg` / `.exe`）
- 当前仓库打包版本：`v0.3.1`
- 当前最新公开版本：`v0.3.1`

## 更新源策略（七牛 + GitHub + Gitee）

- 客户端检查更新顺序：`七牛 -> GitHub -> Gitee`
- 默认七牛更新地址：`https://astra.jitux.com`
- 如需改成其他目录前缀，可设置环境变量 `ASTRASHELL_UPDATE_BASE_URL`
- 当前七牛内容将同步到 `v0.3.1`，但 HTTPS 证书配置仍需修复
- 若要让 Gitee 也可自动更新，需在 Gitee Release 同步上传：
  - `AstraShell-Setup-x.y.z.exe`
  - `AstraShell-Setup-x.y.z.exe.blockmap`
  - `AstraShell-x.y.z.dmg`
  - `AstraShell-x.y.z-mac.zip`
  - `latest.yml`
  - `latest-mac.yml`

### 七牛发布命令

在 `app/` 目录执行：

```bash
export QINIU_ACCESS_KEY=\"你的AK\"
export QINIU_SECRET_KEY=\"你的SK\"
export QINIU_BUCKET=\"astrashell\"
export QINIU_REGION=\"z2\"
export QINIU_PUBLIC_BASE_URL=\"https://astra.jitux.com\"
npm run publish:qiniu
```

- 若你知道上传域名，也可直接用 `QINIU_UPLOAD_HOST` 代替 `QINIU_REGION`
- 如果发版文件放到子目录，例如 `desktop/`，再加 `QINIU_PREFIX=\"desktop\"`
- 七牛侧建议把 `latest.yml` / `latest-mac.yml` 的缓存时间设短，避免更新元数据缓存过久

### 长期复用的发版方式

推荐把密钥文件放到以下任一位置：

- `app/.env.qiniu.local`
- `~/.config/astrashell/qiniu.env`
- `/tmp/astrashell-qiniu.env`

模板可参考 [app/.env.qiniu.example](/Users/jonny/Desktop/AstraShell/app/.env.qiniu.example)。

之后在 `app/` 目录直接执行：

```bash
npm run release:qiniu
```

常用参数：

- `npm run release:qiniu -- --dry-run`：只检查上传列表，不真正上传
- `npm run release:qiniu -- --publish-only`：跳过打包，只上传现有 `release/` 目录内容
- `npm run release:qiniu -- --dist-only`：只打包，不上传
- `npm run release:qiniu -- --env-file ~/.config/astrashell/qiniu.env`：显式指定密钥文件
