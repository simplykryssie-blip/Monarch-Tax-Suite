import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product image uploads go through server actions (images are capped at 4 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // The submission PDF's font is read from disk at runtime (lib/forms/pdf.ts), so ship it with the server code.
  outputFileTracingIncludes: { "/*": ["./lib/forms/fonts/*.ttf"], "/**/*": ["./lib/forms/fonts/*.ttf"] },
  // The firm pages open inside a pop-up (an iframe of the same site). Allow our own origin to frame them and nobody else.
  async headers() {
    const frame = [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }];
    return [{ source: "/efin/:path*", headers: frame }, { source: "/bureau/:path*", headers: frame }];
  },
  async redirects() {
    // /dashboard was the legacy Verexa-style page; the Monarch admin lives at /.
    return [
      { source: "/dashboard", destination: "/", permanent: false },
      // Automation: the Overview, Activity and Settings pages were replaced (run history is a pop-up; integrations moved to Settings).
      { source: "/automation", destination: "/automation/workflows", permanent: false },
      { source: "/automation/activity", destination: "/automation/workflows", permanent: false },
      { source: "/automation/settings", destination: "/settings/integrations", permanent: false },
    ];
  },
};

export default nextConfig;
