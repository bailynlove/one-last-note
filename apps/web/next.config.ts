import path from 'node:path';
import type { NextConfig } from 'next';

// Next only reads .env files from apps/web; this repo keeps one at the root.
try {
  process.loadEnvFile(path.join(process.cwd(), '../..', '.env'));
} catch {
  // .env is optional in CI and deployed environments.
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: ['@oln/config', '@oln/domain', '@oln/application'],
};

export default nextConfig;
