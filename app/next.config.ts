import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // `fallback`, NOT a plain array.
    //
    // Returning an array makes these `afterFiles` rewrites, which Next checks
    // after non-dynamic pages but BEFORE dynamic routes. That silently proxied
    // every /api/v1/clients/[clientId]/... route to the Python backend while
    // /api/v1/clients (non-dynamic) was served locally — so the app looked
    // wired up while every client-scoped route went to the old service.
    //
    // `fallback` runs only after all routes, dynamic ones included, have been
    // checked. Anything this app implements wins; the rest still reaches Python
    // until those endpoints are ported (runs, assets, onboarding, feedback).
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: "http://localhost:8080/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
