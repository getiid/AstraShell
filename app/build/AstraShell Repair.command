#!/bin/bash
set -e

echo "AstraShell 一键修复"
echo "执行命令: xattr -dr com.apple.quarantine /Applications/AstraShell.app"
echo
xattr -dr com.apple.quarantine /Applications/AstraShell.app
echo "修复完成。现在可以重新打开 AstraShell。"
read -r -n 1 -p "按任意键退出..."
echo
