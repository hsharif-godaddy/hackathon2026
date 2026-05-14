export function verticalLazyInnerFloorPx(
  visibleTips: readonly string[],
  naturalHeightsPx: Readonly<Partial<Record<string, number>>>,
  exitingTip: string | null,
): number {
  const t0 = visibleTips[0]
  if (!t0) {
    return 0
  }
  const n0 = naturalHeightsPx[t0] ?? 0
  if (exitingTip === null) {
    return n0
  }
  const t1 = visibleTips[1]
  const n1 = t1 ? (naturalHeightsPx[t1] ?? 0) : 0
  return Math.max(n0, n1)
}

export function maxNaturalTipHeightsPx(
  tipIds: readonly string[],
  naturalHeightsPx: Readonly<Partial<Record<string, number>>>,
): number {
  if (tipIds.length === 0) return 0
  let m = 0
  for (const id of tipIds) {
    m = Math.max(m, naturalHeightsPx[id] ?? 0)
  }
  return m
}
