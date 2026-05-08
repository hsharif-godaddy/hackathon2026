export type ViewportName = 'mobile' | 'laptop';

export interface Viewport {
  name: ViewportName;
  width: number;
  height: number;
}

export const VIEWPORTS: Record<ViewportName, Viewport> = {
  mobile: { name: 'mobile', width: 375, height: 667 },
  laptop: { name: 'laptop', width: 1440, height: 900 },
};

export const VIEWPORT_ORDER: ViewportName[] = ['mobile', 'laptop'];

export type RouteStatus =
  | 'ok'
  | 'redirect'
  | 'notFound'
  | 'serverError'
  | 'unreachable';

export type RouteOrigin = 'homepage' | 'crawl';

export interface DiscoveredRoute {
  path: string;
  url: string;
  origin: RouteOrigin;
  status: RouteStatus;
  httpStatus?: number;
  note?: string;
  isRouteEmpty?: boolean;
}

export interface RenderedSignals {
  title: string;
  h1: string | null;
  headingText: string;
  bodyPreview: string;
}

export interface Tile {
  index: number;
  path: string;
  yOffset: number;
}

export interface ViewportCapture {
  tiles: Tile[];
}

export interface RouteCapture {
  route: DiscoveredRoute;
  rendered?: RenderedSignals;
  perViewport: Record<ViewportName, ViewportCapture>;
}

export interface CapturedSite {
  previewUrl: string;
  generatedAt: string;
  durationMs: number;
  outputDir: string;
  routes: DiscoveredRoute[];
  perRoute: RouteCapture[];
  errors: string[];
}
