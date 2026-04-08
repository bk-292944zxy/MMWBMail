import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 1000,
    webpackBuildWorker: false
  }
};

export default nextConfig;
