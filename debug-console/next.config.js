/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  allowedDevOrigins: [
    'local.console.airo-builder.dev-gdcorp.tools',
    'local.console.airo-builder.gdcorp.tools',
    'local.airo-console.dev-godaddy.com',
    // Legacy hostnames — kept while teams still have /etc/hosts entries for
    // the old setup. Safe to remove once everyone is on the gdcorp.tools name.
    'dev-console.airo-builder.godaddy.com',
    'dev-console.airo-builder.test-godaddy.com',
  ],
  // `gd-auth` uses a nested CJS entrypoint (`gd-auth/src/fetch-key`) that
  // neither Turbopack nor webpack can trace during the app-router build.
  // Marking it external forces runtime Node resolution.
  serverExternalPackages: ['better-sqlite3', 'gd-auth'],
};

export default nextConfig;
