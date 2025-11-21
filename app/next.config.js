import 'tsx';

const gasket = (await import('./gasket.ts')).default;
export default gasket.actions.getNextConfig({
  transpilePackages: ['@wsb/image-manager-loader'],
  experimental: {
    instrumentationHook: true
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false, // Keep TypeScript checks for critical errors
  },
  allowedDevOrigins: [
    'localhost:3000',
    'localhost:8443',
    'local.gasket.dev-godaddy.com:8443',
    'local.gasket.dev-godaddy.com',
    'airo-builder.dev-godaddy.com',
    'airo-builder-local.dev-godaddy.com'
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Exclude server-only modules from client bundle
      // This is the standard Next.js approach for conditional server imports
      config.externals = config.externals || [];
      config.externals.push({
        './jwt-service': 'commonjs ./jwt-service',
      });
      
      // Add fallbacks for Node.js modules that Gasket plugins try to import
      // These modules are not available in the browser, so we provide empty fallbacks
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        path: false,
        os: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        async_hooks: false,
      };
    }
    return config;
  },
});
