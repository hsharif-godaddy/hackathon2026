import { GLYPHS, STROKE_GLYPHS } from './icons'
import { ICON_PX } from './progressTrackerConstants'

/** Renders one inlined stepper glyph; `color` drives currentColor. */
export function Glyph({ name, color }: { name: string; color: string }) {
  const isStroke = STROKE_GLYPHS.has(name)
  return (
    <svg
      width={ICON_PX}
      height={ICON_PX}
      viewBox="0 0 24 24"
      style={{ color }}
      fill={isStroke ? 'none' : 'currentColor'}
      stroke={isStroke ? 'currentColor' : undefined}
      strokeWidth={isStroke ? 2 : undefined}
      strokeLinecap={isStroke ? 'round' : undefined}
      strokeLinejoin={isStroke ? 'round' : undefined}
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  )
}
