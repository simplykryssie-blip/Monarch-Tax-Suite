import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product image uploads go through server actions (images are capped at 4 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // The firm pages open inside a pop-up (an iframe of the same site). Allow our own origin to frame them and nobody else.
  async headers() {
    const frame = [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }];
    return [{ source: "/efin/:path*", headers: frame }, { source: "/bureau/:path*", headers: frame }];
  },
  async redirects() {
    // /dashboard was the legacy Verexa-style page; the Monarch admin lives at /.
    return [{ source: "/dashboard", destination: "/", permanent: false }];
  },
};

export default nextConfig;
