src/entry-server.tsx [105 lines]
     1|import { StrictMode, Suspense } from 'react';
     2|import { renderToString } from 'react-dom/server';
     3|import { HelmetProvider } from '@dr.pogodin/react-helmet';
     4|import type { HelmetServerState } from '@dr.pogodin/react-helmet';
     5|import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     6|import {
     7|  Outlet,
     8|  StaticRouterProvider,
     9|  createStaticHandler,
    10|  createStaticRouter,
    11|  type RouteObject,
    12|} from 'react-router-dom';
    13|
    14|import RootLayout from './layouts/RootLayout';
    15|import Spinner from './components/Spinner';
    16|import { routes } from './routes';
    17|
    18|export interface RenderResult {
    19|  html: string;
    20|  head: string;
    21|  status: number;
    22|  redirect?: string;
    23|}
    24|
    25|const SpinnerFallback = () => (
    26|  <div className="flex justify-center py-8 h-screen items-center">
    27|    <Spinner />
    28|  </div>
    29|);
    30|
    31|// Mirrors the layout wrapping in App.tsx so client and server render the same
    32|// tree. Kept separate from the client `router` in App.tsx because
    33|// createBrowserRouter touches `window` at module load and must never be
    34|// evaluated in the SSR bundle.
    35|const routeTree: RouteObject[] = [
    36|  {
    37|    element: (
    38|      <Suspense fallback={<SpinnerFallback />}>
    39|        <RootLayout>
    40|          <Outlet />
    41|        </RootLayout>
    42|      </Suspense>
    43|    ),
    44|    children: routes,
    45|  },
    46|];
    47|
    48|const handler = createStaticHandler(routeTree);
    49|
    50|export async function render(url: string): Promise<RenderResult> {
    51|  // createStaticHandler works off a WHATWG Request. We only need the pathname +
    52|  // search; scheme/host don't affect routing. Using a stable sentinel host
    53|  // avoids env-dependent URL parsing.
    54|  const context = await handler.query(new Request(`http://ssr${url}`));
    55|
    56|  // A loader/action that throws a Response (or calls redirect()) surfaces here
    57|  // as a Response instead of a StaticHandlerContext. Forward the redirect.
    58|  if (context instanceof Response) {
    59|    return {
    60|      html: '',
    61|      head: '',
    62|      status: context.status,
    63|      redirect: context.headers.get('Location') ?? undefined,
    64|    };
    65|  }
    66|
    67|  const router = createStaticRouter(routeTree, context);
    68|  const helmetContext: { helmet?: HelmetServerState } = {};
    69|  const queryClient = new QueryClient({
    70|    defaultOptions: {
    71|      queries: {
    72|        staleTime: 1000 * 60 * 5,
    73|        gcTime: 1000 * 60 * 10,
    74|        retry: 1,
    75|        refetchOnWindowFocus: false,
    76|      },
    77|      mutations: { retry: 0 },
    78|    },
    79|  });
    80|
    81|  const html = renderToString(
    82|    <StrictMode>
    83|      <HelmetProvider context={helmetContext}>
    84|        <QueryClientProvider client={queryClient}>
    85|          <StaticRouterProvider router={router} context={context} />
    86|        </QueryClientProvider>
    87|      </HelmetProvider>
    88|    </StrictMode>
    89|  );
    90|
    91|  const h = helmetContext.helmet;
    92|  const head = h
    93|    ? [
    94|        h.title?.toString() ?? '',
    95|        h.meta?.toString() ?? '',
    96|        h.link?.toString() ?? '',
    97|        h.script?.toString() ?? '',
    98|      ]
    99|        .filter(Boolean)
   100|        .join('\n')
   101|    : '';
   102|
   103|  return { html, head, status: context.statusCode ?? 200 };
   104|}
   105|