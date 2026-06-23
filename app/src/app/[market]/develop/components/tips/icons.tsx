// Icons are inlined (not @ux/icon) because @ux glyphs render from per-icon CSS
// that is not always bundled, leaving some circles empty. Paths are lifted
// verbatim from @ux/icon SVGs (24x24 viewBox, currentColor fill).
export const GLYPHS: Record<string, React.ReactNode> = {
  lightbulb: (
    <path d="M14.775 20.265h-5.55a.75.75 0 100 1.5h5.55a.75.75 0 100-1.5zM12.124 1.767a7.213 7.213 0 00-4.735 12.768 2.914 2.914 0 011.086 2.235v1.47a.75.75 0 00.75.75h5.55a.75.75 0 00.75-.75v-1.467a2.986 2.986 0 011.12-2.265 7.166 7.166 0 002.576-5.776 7.308 7.308 0 00-7.097-6.965zm1.901 15.003v.72h-4.05v-.72a4.196 4.196 0 00-.063-.554h4.178a4.126 4.126 0 00-.065.551zm1.657-3.412c-.448.38-.821.84-1.1 1.358H9.427a4.538 4.538 0 00-1.081-1.335 5.716 5.716 0 013.753-10.114 5.788 5.788 0 015.622 5.518 5.672 5.672 0 01-2.04 4.573z" />
  ),
  // Stroke-style 3D cube (matches the design's "Defining structure" icon).
  cube: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  // Stroke-style document with text lines (matches the "Creating strategy" icon).
  document: (
    <>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </>
  ),
  // Stroke-style paint palette with filled dots (matches the design's icon).
  palette: (
    <>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      <circle cx="13.5" cy="6.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  // Stroke-style sparkles: one large star plus two small marks (matches the design).
  sparkles: (
    <>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </>
  ),
  check: (
    <path d="M9 18.25a.748.748 0 01-.53-.22l-5-5a.75.75 0 011.06-1.06L9 16.44 19.47 5.97a.75.75 0 011.06 1.06l-11 11a.748.748 0 01-.53.22z" />
  ),
}

// Line-drawing glyphs; the rest are solid fills. (`color` drives currentColor
// so the filled palette dots inside a stroke icon pick up the right color.)
export const STROKE_GLYPHS = new Set(['cube', 'document', 'palette', 'sparkles'])
