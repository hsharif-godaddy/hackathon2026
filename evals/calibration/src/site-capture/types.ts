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

export interface Tile {
  index: number;
  path: string;
  yOffset: number;
}

export interface CaptureDebug {
  finalUrl: string;
  htmlLength: number;
  status: number | null;
  title: string;
  visibleTextLength: number;
  errors?: {
    console: string[];
    page: string[];
  };
  styles?: {
    bodyBg?: string;
    bodyColor?: string;
    htmlBg?: string;
    viewport?: { width: number; height: number; devicePixelRatio: number };
  };
}

export interface ViewportCapture {
  debug?: CaptureDebug;
  error?: string;
  tiles: Tile[];
}

export interface RouteCapture {
  path: string;
  url: string;
  perViewport: Record<ViewportName, ViewportCapture>;
}

export interface CapturedSite {
  previewUrl: string;
  generatedAt: string;
  maxRoutes: number;
  routes: { path: string; url: string }[];
  perRoute: RouteCapture[];
  errors: string[];
}

