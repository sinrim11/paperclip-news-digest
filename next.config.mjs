/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' output is only needed for Docker builds.
  // Set NEXT_STANDALONE=1 in the Docker build environment.
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
};

export default nextConfig;
