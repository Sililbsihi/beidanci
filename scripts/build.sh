#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building the Next.js project..."
pnpm next build

# 校验生产构建产物：缺失则显式失败，避免部署带病上线
if [ ! -f .next/BUILD_ID ]; then
  echo "FATAL: next build did not produce .next/BUILD_ID"
  exit 1
fi
echo "Production build OK (BUILD_ID=$(cat .next/BUILD_ID))"

echo "Bundling server with tsup..."
pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
