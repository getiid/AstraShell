#!/bin/bash
set -e

TARGET_APP="${1:-/Applications/AstraShell.app}"

echo "AstraShell mac 修复工具"
echo "目标应用: ${TARGET_APP}"
echo

if [ ! -d "${TARGET_APP}" ]; then
  echo "未找到应用，请确认 AstraShell.app 已经拖到 应用程序 文件夹。"
  echo "也可以手动执行：xattr -dr com.apple.quarantine /Applications/AstraShell.app"
  read -r -n 1 -p "按任意键退出..."
  echo
  exit 1
fi

xattr -dr com.apple.quarantine "${TARGET_APP}"
echo "已移除隔离属性。"
echo
echo "如果仍提示损坏，请先删除旧应用，再重新拖入 DMG 中的新版本。"
echo
open "${TARGET_APP}" || true
read -r -n 1 -p "修复完成，按任意键退出..."
echo
