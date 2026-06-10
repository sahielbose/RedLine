/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg and pg-boss are server-only; never bundle into client/edge.
  serverExternalPackages: ["pg", "pg-boss", "@anthropic-ai/sdk", "nodemailer"],
  eslint: {
    // Lint is run as its own gate (`npm run lint`), not during `next build`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
