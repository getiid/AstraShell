# LightTerm App

## 已完成

- Electron 桌面壳接入（开发态）
- Vue3 + TypeScript UI 基础
- xterm.js 终端渲染接入
- SSH 连接测试（ssh2）
- 串口列表/打开/发送（serialport）
- 亮色/浅灰主题基础

## 开发运行

```bash
npm install
npm run dev
```

> `npm run dev` 会同时启动 Vite 与 Electron。

## 构建前端

```bash
npm run build
```

## 目录

- `electron/main.mjs`：主进程 + IPC
- `electron/preload.mjs`：安全桥接 API
- `src/App.vue`：主界面（中文）
- `src/theme-light-gray.css`：浅灰主题

## 下一步（我建议）

1. SSH 真实交互终端（非仅测试连接）
2. SFTP 双栏文件管理器
3. 密钥仓库（主密码 + 加密落盘）
4. 串口发送面板增强（HEX/定时发送）
5. 账号同步（登录、冲突处理）
