import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/ppt",
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
