/**
 * Check if two hex colors are similar based on RGB distance
 * @param c1 First hex color (e.g., '#ffffff')
 * @param c2 Second hex color (e.g., '#fefefe')
 * @param threshold Maximum RGB distance to consider colors similar (default 50)
 * @returns true if colors are similar, false otherwise
 */
export function similar(c1: string, c2: string, threshold = 50): boolean {
  const parse = (hex: string) => {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const [r1, g1, b1] = parse(c1)
  const [r2, g2, b2] = parse(c2)
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) < threshold
}
