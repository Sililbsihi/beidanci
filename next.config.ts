import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // 显式固定 Turbopack 工作区根目录，避免部署容器内因多层 lockfile 误推断为 / 导致构建/启动异常
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
