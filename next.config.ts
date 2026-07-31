import type { NextConfig } from "next";

// Privacy: turn off Next.js's anonymous framework telemetry. Bloxable is
// local-first — the only network calls the app makes are the ones the product
// needs (the user's AI provider, Roblox), so the framework should not phone
// home either. Next reads this env var when it constructs its Telemetry
// instance, which happens after this config is loaded in both `next build`
// (node_modules/next/dist/build/index.js) and the dev/prod server
// (node_modules/next/dist/server/lib/router-server.js).
process.env.NEXT_TELEMETRY_DISABLED = "1";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
