---
name: AstraShell 项目配置
description: 项目技术栈、多平台支持与关键文件路径
type: project
---
### 项目概述
- **名称**: AstraShell
- **功能**: 跨平台桌面终端工具（支持 SSH、SFTP、数据库等）。
- **技术栈**: 
  - 前端: Vue 3 + Vite
  - 桌面端: Electron
  - 移动端: Expo (React Native)

### 多平台支持
- **macOS**: 打包为 `.dmg` 和 `.zip`，需开发者签名。
- **Windows**: 打包为 `.nsis` 安装程序。
- **Linux**: 打包为 `.AppImage`。

### 关键文件
- 入口文件:
  - 桌面端: `app/electron/main.mjs`
  - 移动端: `mobile/index.ts`
- 构建配置: `app/package.json` 的 `build` 字段

### 代码质量
- **优点**: 模块化清晰，平台逻辑分离明确。
- **改进点**: 日志管理和错误处理可优化。