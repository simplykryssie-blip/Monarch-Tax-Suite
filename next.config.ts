import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product image uploads go through server actions (images are capped at 4 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async redirects() {
    // /dashboard was the legacy Verexa-style page; the Monarch admin lives at /.
    return [{ source: "/dashboard", destination: "/", permanent: false }];
  },
};

export default nextConfig;
