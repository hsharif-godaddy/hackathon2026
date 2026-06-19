/**
 * Inline SVG icons for the Projects redesign.
 *
 * These are rendered as plain SVGs (not `@ux/icon`) so they display reliably
 * without requiring a per-icon CSS registration in `uxcore-icons.css`, and so
 * their size/color can be controlled directly via Tailwind on the element.
 */

interface IconProps {
  className?: string
}

export function GridViewIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  )
}

export function ListViewIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="8.5" y1="6" x2="20" y2="6" />
      <line x1="8.5" y1="12" x2="20" y2="12" />
      <line x1="8.5" y1="18" x2="20" y2="18" />
      <circle cx="4.25" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.25" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.25" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="12.5" y1="12.5" x2="17.5" y2="17.5" />
    </svg>
  )
}

export function ClearIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

export function KebabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}
