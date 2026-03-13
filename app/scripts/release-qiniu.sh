#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${ASTRASHELL_QINIU_ENV_FILE:-}"
RUN_DIST=1
RUN_PUBLISH=1
PUBLISH_ARGS=()

while (($# > 0)); do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --publish-only)
      RUN_DIST=0
      shift
      ;;
    --dist-only)
      RUN_PUBLISH=0
      shift
      ;;
    --dry-run)
      PUBLISH_ARGS+=("--dry-run")
      shift
      ;;
    --version)
      if (($# < 2)); then
        echo "[release-qiniu] --version 缺少参数" >&2
        exit 1
      fi
      PUBLISH_ARGS+=("--version" "$2")
      shift 2
      ;;
    *)
      echo "[release-qiniu] 不支持的参数: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${ENV_FILE}" ]]; then
  for candidate in \
    "${APP_DIR}/.env.qiniu.local" \
    "${HOME}/.config/astrashell/qiniu.env" \
    "/tmp/astrashell-qiniu.env"
  do
    if [[ -f "${candidate}" ]]; then
      ENV_FILE="${candidate}"
      break
    fi
  done
fi

if [[ -z "${ENV_FILE}" || ! -f "${ENV_FILE}" ]]; then
  echo "[release-qiniu] 未找到环境文件。请使用 --env-file 指定，或创建下列任一文件：" >&2
  echo "  ${APP_DIR}/.env.qiniu.local" >&2
  echo "  ${HOME}/.config/astrashell/qiniu.env" >&2
  echo "  /tmp/astrashell-qiniu.env" >&2
  exit 1
fi

echo "[release-qiniu] using env file: ${ENV_FILE}"
set -a
source "${ENV_FILE}"
set +a

cd "${APP_DIR}"

if ((RUN_DIST)); then
  echo "[release-qiniu] building installers"
  npm run dist
fi

if ((RUN_PUBLISH)); then
  echo "[release-qiniu] publishing to qiniu"
  npm run publish:qiniu -- "${PUBLISH_ARGS[@]}"
fi

