/** Axis-aligned rectangle in image pixels. `x`,`y` are the top-left corner. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

export const right = (b: Box): number => b.x + b.w
export const bottom = (b: Box): number => b.y + b.h
export const area = (b: Box): number => b.w * b.h
export const centreX = (b: Box): number => b.x + b.w / 2
export const centreY = (b: Box): number => b.y + b.h / 2

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(right(a), right(b)) - x, h: Math.max(bottom(a), bottom(b)) - y }
}

export function unionAll(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null
  return boxes.reduce((acc, b) => union(acc, b))
}

/** The overlapping rectangle, or null when they do not touch. */
export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const w = Math.min(right(a), right(b)) - x
  const h = Math.min(bottom(a), bottom(b)) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

export function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    right(inner) <= right(outer) && bottom(inner) <= bottom(outer)
}

/** Overlap as a fraction of the smaller box — the useful measure for "is this inside that". */
export function overlapRatio(a: Box, b: Box): number {
  const hit = intersect(a, b)
  if (!hit) return 0
  return area(hit) / Math.min(area(a), area(b))
}

/** How much two boxes share vertically, as a fraction of the shorter one. Groups words into lines. */
export function verticalOverlap(a: Box, b: Box): number {
  const top = Math.max(a.y, b.y)
  const base = Math.min(bottom(a), bottom(b))
  const shared = base - top
  if (shared <= 0) return 0
  return shared / Math.min(a.h, b.h)
}

/** Grow a box on every side, clamped to the image. */
export function pad(b: Box, by: number, within: { width: number; height: number }): Box {
  return clamp({ x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 }, within)
}

/** Clamp a box to the image, dropping any part that falls outside. */
export function clamp(b: Box, within: { width: number; height: number }): Box {
  const x = Math.max(0, Math.min(b.x, within.width))
  const y = Math.max(0, Math.min(b.y, within.height))
  return {
    x,
    y,
    w: Math.max(0, Math.min(right(b), within.width) - x),
    h: Math.max(0, Math.min(bottom(b), within.height) - y),
  }
}
