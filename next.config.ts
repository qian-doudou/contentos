import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Support loopback browser-based QA without weakening non-local origins.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
