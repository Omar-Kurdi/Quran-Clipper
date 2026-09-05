import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * How much of a request body the framework buffers when middleware runs.
     *
     * `src/middleware.ts` matches every path, and a matched request has its
     * body cloned and buffered so both the middleware and the route can read
     * it. The default ceiling is 10MB, and past it the body is silently
     * *truncated* rather than refused -- which reaches the route as a
     * half-written multipart stream and fails as "Failed to parse body as
     * FormData". A recitation is routinely bigger than that: 021.mp3, a single
     * chapter, is 34MB.
     *
     * This is a local studio tool uploading one file at a time, so the memory
     * this admits is bounded by what a person can pick in a file dialog.
     */
    proxyClientMaxBodySize: '256mb'
  },
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
