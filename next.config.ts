import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.3", "192.168.1.*", "localhost:3000"],
};

export default nextConfig;

