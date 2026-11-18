import type { NextConfig } from "next";
import { browserEnv, studioMode } from "./src/lib/studioMode";

const nextConfig: NextConfig = {
  /** A public studio's browser carries the translation its server serves -- see `browserEnv`. */
  env: browserEnv(),
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
     * this admits is bounded by what a person can pick in a file dialog. A
     * personal studio takes a whole long surah -- one reciter's Al-Baqarah is
     * 209 MB -- which a public one, keeping no visitor's recording, does not.
     */
    proxyClientMaxBodySize: studioMode() === 'public' ? '256mb' : '640mb'
  }
};

export default nextConfig;
