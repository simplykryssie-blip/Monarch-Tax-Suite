import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // /dashboard was the legacy Verexa-style page; the Monarch admin lives at /.
    return [{ source: "/dashboard", destination: "/", permanent: false }];
  },
};

export default nextConfig;
