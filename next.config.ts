import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@github/copilot-sdk"],
};

export default nextConfig;
