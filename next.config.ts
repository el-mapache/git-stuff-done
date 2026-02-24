import type { NextConfig } from "next";

const isDemoExport = process.env.DEMO_EXPORT === "true";

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(isDemoExport
    ? { output: "export", basePath: "/git-stuff-done" }
    : { serverExternalPackages: ["@github/copilot-sdk"] }),
};

export default nextConfig;
