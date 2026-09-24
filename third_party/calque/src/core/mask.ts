import { blur, greyscale, type Raster } from './image.js'
import { type Box } from './geom.js'

/** A binary image. One byte per pixel so it can be indexed without bit fiddling. */
export interface Mask {
  width: number
  height: number
  data: Uint8Array
}

export function emptyMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) }
}

export function countSet(m: Mask): number {
  let n = 0
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) n++
  return n
}

export interface InkOptions {
  /** How far a pixel must sit from its neighbourhood to count as ink, 0–255. */
  threshold?: number
  /** Neighbourhood radius for the background estimate. */
  radius?: number
}

/**
 * Ink: everything that differs from its own local background.
 *
 * The naive version of this thresholds on darkness, which finds nothing at all
 * on a dark theme and finds the whole page on a gradient. Subtracting a blurred
 * copy asks a question that has the same answer either way round — light text
 * on dark and dark text on light both come out as ink, and a smooth gradient
 * comes out as nothing, because it *is* its own neighbourhood.
 *
 * The comparison runs per channel rather than on luminance. Luminance alone
 * loses text whose colour differs from its background in hue but not in
 * brightness, which is not a corner case: mint green display type over a green
 * glow measured almost identical luma, and the headline came apart into
 * "Unlo⬚⬚able" — the two letters that happened to sit over the brightest part
 * of the glow simply vanished.
 */
export function inkMask(raster: Raster, options: InkOptions = {}): Mask {
  const threshold = options.threshold ?? 26
  const radius = options.radius ?? 12
  const count = raster.width * raster.height

  const mask = emptyMask(raster.width, raster.height)
  for (let channel = 0; channel < 3; channel++) {
    const plane = new Uint8ClampedArray(count)
    for (let i = 0; i < count; i++) plane[i] = raster.data[i * 4 + channel] ?? 0
    const background = blur(plane, raster.width, raster.height, radius)
    for (let i = 0; i < count; i++) {
      if (Math.abs((plane[i] ?? 0) - (background[i] ?? 0)) > threshold) mask.data[i] = 1
    }
  }
  return mask
}

/** Luminance-only ink. Kept for comparison and for the tests that pin the difference. */
export function luminanceInkMask(raster: Raster, options: InkOptions = {}): Mask {
  const threshold = options.threshold ?? 26
  const radius = options.radius ?? 12
  const grey = greyscale(raster)
  const background = blur(grey, raster.width, raster.height, radius)

  const mask = emptyMask(raster.width, raster.height)
  for (let i = 0; i < grey.length; i++) {
    if (Math.abs((grey[i] ?? 0) - (background[i] ?? 0)) > threshold) mask.data[i] = 1
  }
  return mask
}

/** Grow set pixels sideways by `radius`, closing the gaps between glyphs. */
export function dilateHorizontal(m: Mask, radius: number): Mask {
  if (radius < 1) return { ...m, data: m.data.slice() }
  const out = emptyMask(m.width, m.height)
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width
    let carry = 0
    for (let x = 0; x < m.width; x++) {
      if (m.data[row + x]) carry = radius + 1
      if (carry > 0) { out.data[row + x] = 1; carry-- }
    }
    carry = 0
    for (let x = m.width - 1; x >= 0; x--) {
      if (m.data[row + x]) carry = radius + 1
      if (carry > 0) { out.data[row + x] = 1; carry-- }
    }
  }
  return out
}

/** Grow set pixels vertically by `radius`. Kept small: it merges separate lines. */
export function dilateVertical(m: Mask, radius: number): Mask {
  if (radius < 1) return { ...m, data: m.data.slice() }
  const out = emptyMask(m.width, m.height)
  for (let x = 0; x < m.width; x++) {
    let carry = 0
    for (let y = 0; y < m.height; y++) {
      const i = y * m.width + x
      if (m.data[i]) carry = radius + 1
      if (carry > 0) { out.data[i] = 1; carry-- }
    }
    carry = 0
    for (let y = m.height - 1; y >= 0; y--) {
      const i = y * m.width + x
      if (m.data[i]) carry = radius + 1
      if (carry > 0) { out.data[i] = 1; carry-- }
    }
  }
  return out
}

export interface Component extends Box {
  /** Set pixels inside the bounding box. Density separates a glyph run from a rule. */
  pixels: number
}

export const density = (c: Component): number => c.pixels / Math.max(1, c.w * c.h)

/**
 * Four-connected components, flood filled from an explicit stack.
 *
 * Recursion blows the call stack on a full-page screenshot: one component here
 * routinely covers a hundred thousand pixels.
 */
export function components(m: Mask, minPixels = 1): Component[] {
  const seen = new Uint8Array(m.data.length)
  const stack = new Int32Array(m.data.length)
  const found: Component[] = []

  for (let start = 0; start < m.data.length; start++) {
    if (!m.data[start] || seen[start]) continue

    let top = 0
    stack[top++] = start
    seen[start] = 1

    let minX = start % m.width
    let maxX = minX
    let minY = (start / m.width) | 0
    let maxY = minY
    let pixels = 0

    while (top > 0) {
      const p = stack[--top] as number
      const px = p % m.width
      const py = (p / m.width) | 0
      pixels++
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py

      if (px > 0 && m.data[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1 }
      if (px < m.width - 1 && m.data[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1 }
      if (py > 0 && m.data[p - m.width] && !seen[p - m.width]) { seen[p - m.width] = 1; stack[top++] = p - m.width }
      if (py < m.height - 1 && m.data[p + m.width] && !seen[p + m.width]) {
        seen[p + m.width] = 1
        stack[top++] = p + m.width
      }
    }

    if (pixels >= minPixels) {
      found.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels })
    }
  }
  return found
}

/** Set pixels per row. The profile whose valleys are the gaps between sections. */
export function rowProfile(m: Mask, region?: Box): Int32Array {
  const y0 = region?.y ?? 0
  const y1 = region ? region.y + region.h : m.height
  const x0 = region?.x ?? 0
  const x1 = region ? region.x + region.w : m.width

  const profile = new Int32Array(Math.max(0, y1 - y0))
  for (let y = y0; y < y1; y++) {
    let n = 0
    const row = y * m.width
    for (let x = x0; x < x1; x++) if (m.data[row + x]) n++
    profile[y - y0] = n
  }
  return profile
}

/** Set pixels per column, within a region. The profile whose valleys are column gutters. */
export function columnProfile(m: Mask, region?: Box): Int32Array {
  const y0 = region?.y ?? 0
  const y1 = region ? region.y + region.h : m.height
  const x0 = region?.x ?? 0
  const x1 = region ? region.x + region.w : m.width

  const profile = new Int32Array(Math.max(0, x1 - x0))
  for (let y = y0; y < y1; y++) {
    const row = y * m.width
    for (let x = x0; x < x1; x++) {
      if (m.data[row + x]) profile[x - x0] = (profile[x - x0] ?? 0) + 1
    }
  }
  return profile
}

export interface Run {
  start: number
  end: number
}

/**
 * Contiguous stretches where the profile stays above `floor`, ignoring runs
 * shorter than `minLength`.
 */
export function runsAbove(profile: ArrayLike<number>, floor: number, minLength = 1): Run[] {
  const runs: Run[] = []
  let start = -1
  for (let i = 0; i < profile.length; i++) {
    const above = (profile[i] ?? 0) > floor
    if (above && start < 0) start = i
    if (!above && start >= 0) {
      if (i - start >= minLength) runs.push({ start, end: i })
      start = -1
    }
  }
  if (start >= 0 && profile.length - start >= minLength) runs.push({ start, end: profile.length })
  return runs
}

/** The inverse: stretches at or below `floor`. Gaps, gutters and margins. */
export function runsBelow(profile: ArrayLike<number>, floor: number, minLength = 1): Run[] {
  const runs: Run[] = []
  let start = -1
  for (let i = 0; i < profile.length; i++) {
    const below = (profile[i] ?? 0) <= floor
    if (below && start < 0) start = i
    if (!below && start >= 0) {
      if (i - start >= minLength) runs.push({ start, end: i })
      start = -1
    }
  }
  if (start >= 0 && profile.length - start >= minLength) runs.push({ start, end: profile.length })
  return runs
}
