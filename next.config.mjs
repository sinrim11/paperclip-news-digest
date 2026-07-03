import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' output is only needed for Docker builds.
  // Set NEXT_STANDALONE=1 in the Docker build environment.
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  serverExternalPackages: ['@prisma/client'],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
