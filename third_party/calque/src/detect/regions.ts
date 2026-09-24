import { type Box, right, union, verticalOverlap } from '../core/geom.js'
import {
  type Component,
  type Mask,
  components,
  density,
  dilateHorizontal,
  dilateVertical,
} from '../core/mask.js'

export interface Region extends Box {
  /** Ink pixels inside. */
  pixels: number
  /** Sub-components merged in — roughly a glyph count for text. */
  parts: number
}

export interface RegionOptions {
  /** Glyph pieces smaller than this are speckle. */
  minGlyphPixels?: number
  /**
   * Two pieces join into one line when the gap between them is under this
   * multiple of their height. A word space is about a quarter of the line
   * height; anything past one whole line height is a separate element.
   */
  gapRatio?: number
  /** Pieces whose heights differ by more than this never join. */
  heightRatio?: number
  /** Pixels of ink-mask rim to remove from every side. See `inkOvershoot`. */
  overshoot?: number
}

const DEFAULTS: Required<RegionOptions> = {
  minGlyphPixels: 6,
  gapRatio: 0.9,
  heightRatio: 2.4,
  overshoot: 1,
}

/**
 * Glyph-level blobs.
 *
 * Dilating by one or two pixels reattaches the dot of an `i` and the two bars
 * of an `=` without yet merging neighbouring words.
 */
export function glyphs(ink: Mask, options: RegionOptions = {}): Component[] {
  const settings = { ...DEFAULTS, ...options }
  const joined = dilateVertical(dilateHorizontal(ink, 2), 1)
  return components(joined, settings.minGlyphPixels)
}

/**
 * Anything too big to be a glyph: a photograph, an illustration, a chart.
 *
 * Split out before line grouping, because a single dense blob covering half the
 * page will otherwise swallow every caption sitting on top of it.
 */
export function isGraphic(c: Component, page: { width: number; height: number }): boolean {
  const tallEnough = c.h > page.height * 0.14
  const wideEnough = c.w > page.width * 0.22
  const big = c.w * c.h > page.width * page.height * 0.035
  return big && tallEnough && wideEnough && density(c) > 0.35
}

/**
 * Group glyph blobs into text lines.
 *
 * This is the step that replaces the OCR engine's own page layout analysis.
 * Tesseract reads a cropped line perfectly and mangles a full-page screenshot,
 * because its layout model expects a scanned document — one type size, one
 * column, dark on light. A web page is none of those. So the grouping happens
 * here, on geometry, and the OCR engine only ever sees a single line at a time.
 */
export function groupLines(pieces: readonly Component[], options: RegionOptions = {}): Region[] {
  const settings = { ...DEFAULTS, ...options }
  const sorted = [...pieces].sort((a, b) => a.x - b.x || a.y - b.y)
  const parent = sorted.map((_, i) => i)

  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root] as number
    let walk = i
    while (parent[walk] !== root) {
      const next = parent[walk] as number
      parent[walk] = root
      walk = next
    }
    return root
  }
  const join = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    if (!a) continue
    const reach = Math.max(a.h, 12) * settings.gapRatio

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]
      if (!b) continue

      // Sorted by x, so once the next piece starts beyond the widest possible
      // reach there is nothing further to test.
      const gap = b.x - right(a)
      if (gap > Math.max(reach, b.h * settings.gapRatio)) break
      if (verticalOverlap(a, b) < 0.45) continue

      const tall = Math.max(a.h, b.h)
      const short = Math.min(a.h, b.h)
      if (tall / short > settings.heightRatio) continue
      if (gap > tall * settings.gapRatio) continue

      join(i, j)
    }
  }

  const groups = new Map<number, Region>()
  for (let i = 0; i < sorted.length; i++) {
    const piece = sorted[i]
    if (!piece) continue
    const root = find(i)
    const existing = groups.get(root)
    if (existing) {
      const merged = union(existing, piece)
      groups.set(root, {
        ...merged,
        pixels: existing.pixels + piece.pixels,
        parts: existing.parts + 1,
      })
    } else {
      groups.set(root, { x: piece.x, y: piece.y, w: piece.w, h: piece.h, pixels: piece.pixels, parts: 1 })
    }
  }

  return [...groups.values()].sort((a, b) => a.y - b.y || a.x - b.x)
}

export interface Segmentation {
  /** Candidate text lines, top to bottom. */
  lines: Region[]
  /** Blobs too large and too dense to be type. */
  graphics: Region[]
  /** Outlines that turned out to enclose other elements: panels, inputs, cards. */
  containers: Region[]
}

/**
 * Separate outlines that enclose other elements from the elements themselves.
 *
 * An input with a visible border is one connected ring of ink. Dilated, it
 * merges with the text inside it, and the whole control becomes a single
 * "line" whose height is the height of the box — so a 19px placeholder in a
 * 53px field gets read a second time as 60px type, and the same words land in
 * the output twice at two different sizes.
 *
 * A line of text never contains another line of text. Anything that does is a
 * container, and belongs to the surface pass rather than the text pass.
 */
export function separateContainers(lines: readonly Region[]): { lines: Region[]; containers: Region[] } {
  const kept: Region[] = []
  const containers: Region[] = []

  for (const candidate of lines) {
    const enclosed = lines.filter(
      other =>
        other !== candidate &&
        other.x >= candidate.x - 1 &&
        other.y >= candidate.y - 1 &&
        right(other) <= right(candidate) + 1 &&
        other.y + other.h <= candidate.y + candidate.h + 1 &&
        other.w * other.h < candidate.w * candidate.h * 0.85,
    )

    // Hollow as well as enclosing: a bold word can bound a smaller one beside
    // it by accident, but it will not also be mostly empty.
    const fill = candidate.pixels / Math.max(1, candidate.w * candidate.h)
    if (enclosed.length > 0 && fill < 0.34) containers.push(candidate)
    else kept.push(candidate)
  }

  return { lines: kept, containers }
}

/**
 * How far the ink mask overshoots the glyphs it found, in pixels per side.
 *
 * Background subtraction cannot have a sharp edge. Just outside a letter the
 * blur window still contains part of that letter, so the local background reads
 * lower than the true background and the difference clears the threshold for a
 * short distance out — the mask is the glyph plus a rim, and every box is that
 * much too big in all four directions.
 *
 * Measured against a fixture whose real values are known, one pixel per side is
 * the correction, and it was one pixel at radius 2, 3 and 4 alike — it does not
 * track the radius over the range that is any use, because the threshold gates
 * the rim long before the radius does. Correcting for it took mean font-size
 * error from 13.2% to 3.4%; uncorrected, 14px type measured 17px and 20px type
 * measured 21px.
 *
 * Deliberately not a function of radius: fitting one to three points that are
 * all the same value would be inventing a relationship the data does not show.
 */
export const INK_OVERSHOOT = 1

/** Pull a box in by `by` pixels on every side, never past nothing. */
export function shrink(region: Region, by: number): Region {
  if (by <= 0) return region
  const take = Math.min(by, Math.floor((region.w - 1) / 2), Math.floor((region.h - 1) / 2))
  if (take <= 0) return region
  return { ...region, x: region.x + take, y: region.y + take, w: region.w - take * 2, h: region.h - take * 2 }
}

export function segment(ink: Mask, options: RegionOptions = {}): Segmentation {
  const page = { width: ink.width, height: ink.height }
  const pieces = glyphs(ink, options)

  const graphics: Region[] = []
  const typeish: Component[] = []
  for (const piece of pieces) {
    if (isGraphic(piece, page)) graphics.push({ ...piece, parts: 1 })
    else typeish.push(piece)
  }

  const overshoot = options.overshoot ?? 0
  const grouped = groupLines(typeish, options)
    .filter(line => line.w >= 4 && line.h >= 5)
    .map(line => shrink(line, overshoot))
  const { lines, containers } = separateContainers(grouped)
  return { lines, graphics: graphics.map(g => shrink(g, overshoot)), containers }
}
