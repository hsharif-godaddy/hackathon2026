src/App.tsx [28-47 of 72] (truncated — use startLine/numLines to read remaining)
    28|const rootElement = (
    29|  <Suspense fallback={<SpinnerFallback />}>
    30|    <RootLayout>
    31|      <Outlet />
    32|    </RootLayout>
    33|  </Suspense>
    34|);
    35|
    36|// Wrap the agent-editable flat `routes` array in a layout route so ScrollRestoration
    37|// + shared chrome live once above every page. Keeping the wrap here (instead of
    38|// in routes.tsx) preserves the agent's simple flat-route contract. The dev
    39|// boundary must live inside the route element so React Router doesn't replace it
    40|// with its default route error UI before our boundary can catch render errors.
    41|const routeTree: RouteObject[] = [
    42|  {
    43|    element:
    44|      import.meta.env.MODE === 'development' ? (
    45|        <AiroErrorBoundary>{rootElement}</AiroErrorBoundary>
    46|      ) : (
    47|        rootElement