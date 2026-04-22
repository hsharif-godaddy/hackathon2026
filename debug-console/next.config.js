/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  allowedDevOrigins: ['dev-console.airo-builder.godaddy.com'],
  // `gd-auth` uses a nested CJS entrypoint (`gd-auth/src/fetch-key`) that
  // neither Turbopack nor webpack can trace during the app-router build.
  // Marking it external forces runtime Node resolution.
  serverExternalPackages: ['gd-auth'],
};

export default nextConfig;
