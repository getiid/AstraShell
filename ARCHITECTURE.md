# LightTerm 技术架构

## 技术选型
- 桌面壳：Electron
- 前端：Vue3 + TypeScript + Vite + Pinia + Naive UI
- 终端：xterm.js
- SSH/SFTP：ssh2
- 串口：serialport
- 本地数据库：SQLite
- 加密：应用层 AES-256-GCM + Argon2/PBKDF2
- 同步后端：后续可接 Supabase/Firebase/自建 API

## 模块划分
1. app-shell（Electron 主进程）
2. renderer-ui（Vue 页面）
3. protocol-ssh（SSH/SFTP 抽象）
4. protocol-serial（串口抽象）
5. key-vault（密钥仓库）
6. sync-engine（同步引擎）
7. storage（SQLite 持久化）

## 关键流程
- 启动 -> 解锁密钥仓库 -> 加载连接配置 -> 打开会话
- SSH 会话 -> xterm 渲染 -> 命令历史持久化
- SFTP -> 远程树与本地树同步刷新
- 串口 -> 输入输出流 + 发送面板队列

## 安全设计（V1）
- 主密码仅用于派生密钥，不明文存储
- 私钥加密后落盘
- 同步前进行字段级脱敏（可配置）
