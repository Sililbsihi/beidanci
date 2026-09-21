#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    # 强制生产模式：杜绝生产误跑 Next dev（dev 按需编译内存暴涨且 HMR 脚本在网关后崩溃）
    PORT=${DEPLOY_RUN_PORT} NODE_ENV=production COZE_PROJECT_ENV=PROD node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
