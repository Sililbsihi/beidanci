#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    # 生产模式强制项：杜绝生产误跑 Next dev
    export NODE_ENV=production
    export COZE_PROJECT_ENV=PROD

    # 优先走 Next 官方生产路径（自带构建产物校验）；产物缺失时明确报错退出
    if [ -f .next/BUILD_ID ]; then
      echo "Found production build (BUILD_ID=$(cat .next/BUILD_ID)), starting next start..."
      exec npx next start -p "${DEPLOY_RUN_PORT}" -H 0.0.0.0
    fi

    echo "FATAL: .next/BUILD_ID not found - production build missing!"
    exit 1
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
