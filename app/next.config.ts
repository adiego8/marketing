import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both are large CommonJS packages that Next's bundler mangles; they must
  // stay external and be required at runtime. numerico-website carries the
  // same line for the same reason.
  serverExternalPackages: ["googleapis", "@react-pdf/renderer"],
};

export default nextConfig;
