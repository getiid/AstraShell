# GitHub 发布流程（AstraShell）

## 1. 提交代码
```bash
cd /Users/jonny/Desktop/AstraShell
git add -A
git commit -m "feat: UI polish, SFTP dual-pane improvements and snippets runner"
git push origin main
```

## 2. 生成安装包
```bash
cd /Users/jonny/Desktop/AstraShell/app
npm run dist
```

输出文件：
- `app/release/AstraShell-0.2.0-arm64.dmg`
- `app/release/AstraShell-0.2.0-arm64.dmg.blockmap`

说明：
- 当前配置默认 `mac.identity = null`，会跳过签名，优先保证可打包可运行。

## 3. 发布 GitHub Release
```bash
cd /Users/jonny/Desktop/AstraShell
git tag -a v0.2.0 -m "AstraShell v0.2.0"
git push origin v0.2.0
gh release create v0.2.0 \
  app/release/AstraShell-0.2.0-arm64.dmg \
  app/release/AstraShell-0.2.0-arm64.dmg.blockmap \
  --title "AstraShell v0.2.0" \
  --notes "Desktop release with hosts/sftp/vault/snippets updates."
```

## 4. 验证点
- `gh release view v0.2.0` 可以看到附件。
- 在一台干净 macOS 设备下载 DMG，验证可安装、可启动、可连接 SSH。
