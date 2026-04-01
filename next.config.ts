import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/comparador",
  images: { unoptimized: true },
};

export default nextConfig;
