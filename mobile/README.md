# AstraShell Mobile

Android / iOS 客户端（Expo + React Native）。

## 当前阶段

- 已完成移动端 UI 骨架：
  - 主机
  - SFTP
  - 代码片段
  - 设置
- 当前为离线原型数据，下一步接桌面端同源数据与真实连接能力。
- 仓库仅保留脱敏示例数据，禁止提交真实服务器 IP、账号、密钥或数据库连接信息。

## 运行

```bash
npm install
npm run start
```

Expo 控制台快捷键：

- `a`：Android
- `i`：iOS
- `w`：Web 预览

## 下一步

1. 设计移动端 SSH 会话页（输入、输出、复制粘贴）
2. 接入真实主机数据与密钥仓库
3. 打通 SFTP 文件操作链路
4. 接入代码片段执行编排
