import 'tsx';

const gasket = (await import('./gasket.ts')).default;
export default gasket.actions.getNextConfig({
  experimental: {
    instrumentationHook: true
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false, // Keep TypeScript checks for critical errors
  },
});
