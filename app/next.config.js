import 'tsx';

const gasket = (await import('./gasket.ts')).default;
const elasticApm = gasket.config.elasticApm || {};

export default gasket.actions.getNextConfig({
  env: {
    NEXT_PUBLIC_ELASTIC_APM_SERVER_URL: process.env.NEXT_PUBLIC_ELASTIC_APM_SERVER_URL || elasticApm.serverUrl || '',
    NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT: process.env.NEXT_PUBLIC_ELASTIC_APM_ENVIRONMENT || elasticApm.environment || '',
  },
  experimental: {
    instrumentationHook: true,
    outputFileTracingIncludes: {
      '/explore/[name]/[[...lang]]': ['./src/data/landing-pages/**/*.yaml'],
    },
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
  webpack: (config, { isServer, dev }) => {
    // Reduce file watching to prevent EMFILE errors
    if (dev) {
      config.watchOptions = {
        ignored: /[\\/](node_modules|\.git|\.next|dist|build|coverage|__tests__|packages|agents|scripts|app-templates|certificates|\.cursor|data|tests|dev-supervisor|proxy|design-rag|bedrock-log-viewer|debug-console|agentic-qa|e2e|cdk|setup|website|\.worktrees|\.claude)[\\/]/,
        aggregateTimeout: 300,
      };
    }

    // Suppress webpack warnings for dynamic imports in plugin systems
    // These are expected for @venture/cds-utils and @gasket/plugin-dynamic-plugins
    // Merge with existing warnings instead of replacing them
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      /Critical dependency: the request of a dependency is an expression/,
    ];

    if (isServer) {
      // Externalize server-only packages that webpack can't bundle
      config.externals = config.externals || [];
      config.externals.push({
        '@azure/functions-core': 'commonjs @azure/functions-core',
        '@godaddy/gd-auth-lib': 'commonjs @godaddy/gd-auth-lib',
      });
    }

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
        worker_threads: false,
        child_process: false,
        dns: false,
        dgram: false,
        module: false,
        perf_hooks: false,
        v8: false,
        inspector: false,
        constants: false,
        util: false,
      };

    }
    return config;
  },
});
