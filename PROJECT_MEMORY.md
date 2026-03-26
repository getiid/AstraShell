# AstraShell Project Memory

## 项目定位

AstraShell 是一个面向个人运维和轻量服务器管理的桌面终端工作台。
当前主线是 `app/` 下的 Electron + Vue 3 桌面端，核心目标是把 SSH、SFTP、代码片段、密钥管理、串口、本地终端和同步中心放进一个统一工作流。

## 当前重点

- 主线发布仓库：`origin -> git@github.com:getiid/AstraShell.git`
- 当前桌面端版本：`0.3.14`
- 公开更新源：GitHub Release
- 当前对外文档入口：`README.md` + `docs/index.html`
- 当前文档截图资源：`docs/screenshots/workspace-2026-03-26.svg`、`docs/screenshots/local-panel-2026-03-26.svg`
- 数据策略：应用内固定本地数据库，外部数据库文件只作为同步目标，不更换库类型
- 同步建议场景：iCloud、SMB、U 盘、NAS 挂载目录，不建议公网直接暴露数据库文件

## 代码结构

- `app/`: Electron + Vue 3 桌面端，也是当前主要发布物
- `mobile/`: Expo React Native 移动端
- `docs/`: 截图和发布资料
- `资料/`: 本地交接资料，不上 GitHub

## 桌面端核心模块

- 主机管理：分类、聚焦卡片、编辑面板、到期预警
- SSH 终端：多标签、标签关闭、状态栏、片段调用
- SFTP：双栏工作区，本地/远程独立连接，支持拖拽和排序
- 代码片段：分类、手动执行、提醒日期、执行结果
- 本地终端：多标签、返回不掉线、单击选中标签、双击进入会话
- 密钥管理：私钥 / 公钥 / 证书统一管理
- 同步中心：本地数据库 + 外部数据库文件同步
- 自动更新：GitHub Release
- 操作日志：按目标聚合输入和系统反馈，避免一进一出碎片化记录

## 开发与发布

- 本地开发：`cd app && npm run dev`
- Web 构建验证：`cd app && npm run build:web`
- 桌面端打包：`cd app && npm run dist`
- 版本号来源：`app/package.json`
- README 当前公开版本描述需要和 release 版本保持一致
- 发布页静态内容来源：`docs/index.html`
- 发布前建议同步更新：`README.md`、`docs/index.html`、`docs/release-notes/`

## 已知发布注意事项

- `gh auth status` 当前显示 GitHub token 失效；如果要直接用 `gh release create/upload`，需要先重新登录
- macOS DMG 内包含《AstraShell 安装说明.txt》
- macOS 构建未签名，用户下载后仍可能需要执行：
  `xattr -dr com.apple.quarantine /Applications/AstraShell.app`
- Windows 自动升级依赖 GitHub Release 附件和对应 `latest.yml`

## 下次接手时优先检查

- `git status --short`
- `app/package.json` 当前版本号
- `README.md` 当前公开版本说明
- `docs/index.html` 下载按钮、截图和文案是否与当前版本一致
- `docs/screenshots/` 是否还是当前 UI 的展示图
- `app/src/components/panels/` 下几个主面板最近的 UI 调整
- `app/src/composables/` 下 SSH / SFTP / 代码片段 / 同步相关逻辑
