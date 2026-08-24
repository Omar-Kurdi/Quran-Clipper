import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // The studio is the product. There is no signup, no dashboard and no
        // content to browse, so a marketing page in front of it only added a
        // click between opening the app and using it.
        source: "/",
        destination: "/video-creator",
        permanent: false
      }
    ];
  }
};

export default nextConfig;
