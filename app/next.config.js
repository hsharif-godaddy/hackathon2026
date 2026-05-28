import 'tsx';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const gasket = (await import('./gasket.ts')).default;

export default gasket.actions.getNextConfig({
  // AWS SDK clients are huge module graphs (hundreds of files per client).
  // Listing them here tells Next/webpack to require them at runtime instead
  // of bundling, which keeps the server-side compilation memory footprint
  // bounded — without this, adding a single new SDK client (e.g.
  // @aws-sdk/client-lambda for the feedback fan-out invoke path) tips the
  // build over the default 2GB heap. They're always resolved at runtime
  // from node_modules on the server, so externalising them is purely a
  // build-time optimisation, not a runtime change.
  serverExternalPackages: [
    '@azure/functions-core',
    '@godaddy/gd-auth-lib',
    'parquetjs',
    '@aws-sdk/client-lambda',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-sts',
  ],
  outputFileTracingIncludes: {
    '/explore/[name]/[[...lang]]': ['./src/data/landing-pages/**/*.yaml'],
  },
  experimental: {
    optimizePackageImports: [
      'react-intl',
      '@formatjs/intl',
      'lucide-react',
      'zod',
      '@tanstack/react-query',
      '@tanstack/react-table',
    ],
  },
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
  devIndicators: {
    position: 'top-left',
  },
  allowedDevOrigins: [
    'localhost:3000',
    'localhost:8443',
    'local.gasket.dev-godaddy.com:8443',
    'local.gasket.dev-godaddy.com',
    'airo-builder.dev-godaddy.com',
    'airo-builder-local.dev-godaddy.com',
    'airo-builder.test-godaddy.com',
    'airo-builder.test-godaddy.com:8443',
  ],
  webpack: (config, { isServer, dev }) => {
    // Reduce file watching to prevent EMFILE errors
    if (dev) {
      config.watchOptions = {
        ignored: /[\\/](node_modules|\.git|\.next|dist|build|coverage|__tests__|packages|agents|scripts|app-templates|certificates|\.cursor|data|tests|dev-supervisor|proxy|design-rag|bedrock-log-viewer|debug-console|e2e|cdk|setup|website|\.worktrees|\.claude)[\\/]/,
        aggregateTimeout: 300,
      };
    }

    // Suppress webpack warnings for dynamic imports in plugin systems
    // These are expected for @venture/cds-utils and @gasket/plugin-dynamic-plugins
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      /Critical dependency: the request of a dependency is an expression/,
    ];

    // konva's package.json "main" points to index-node.js (Node build) which requires
    // the native 'canvas' package. Force the browser build for all webpack compilations
    // so the server bundle never encounters the canvas dependency.
    config.resolve.alias = {
      ...config.resolve.alias,
      'konva$': 'konva/lib/index.js',
      '@cds/deps-esm': path.resolve(__dirname, 'cds/deps-esm.js'),
    };

    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@azure/functions-core': 'commonjs @azure/functions-core',
        '@godaddy/gd-auth-lib': 'commonjs @godaddy/gd-auth-lib',
        parquetjs: 'commonjs parquetjs',
      });
    }

    if (!isServer) {
      // Exclude server-only modules from client bundle
      config.externals = config.externals || [];
      config.externals.push({
        './jwt-service': 'commonjs ./jwt-service',
      });

      // gasket-plugin-auth normally aliases these to false for client builds,
      // but it only loads in JWT mode. In mock mode the hook never runs and
      // webpack follows gd-auth-lib's dynamic native require to the .node
      // binaries, which it can't parse. Mirror the alias unconditionally.
      config.resolve.alias = {
        ...config.resolve.alias,
        'gd-auth': false,
        '@godaddy/gd-auth-lib': false,
      };

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
