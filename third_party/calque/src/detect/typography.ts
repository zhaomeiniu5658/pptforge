import { type Rgb } from '../core/colour.js'
import { type Box, clamp, pad } from '../core/geom.js'
import { type Raster } from '../core/image.js'
import { type Mask } from '../core/mask.js'
import { textMask } from './palette.js'

/**
 * Tighten a region onto the actual glyphs.
 *
 * The ink mask finds elements but does not bound them. Background subtraction
 * over a twelve pixel radius haloes: around small type the blur window spans
 * several letters at once, so the background *between* letters is lifted by its
 * neighbours and marked as ink too. A word stops being letters and becomes a
 * solid slab a few pixels larger than the type on every side — which measured
 * 15px nav labels at 20px of ink, and reported them as 21px type.
 *
 * Classifying each pixel as the nearer of the region's two measured colours has
 * no such halo, so the tight box comes from that instead. Every font size,
 * position and gap in the output depends on this being right.
 */
export function typographicBox(raster: Raster, region: Box, foreground: Rgb, background: Rgb): Box {
  const margin = Math.max(2, Math.round(region.h * 0.35))
  const area = pad(region, margin, raster)
  const mask = textMask(raster, area, foreground, background)

  const rows = new Int32Array(mask.height)
  const columns = new Int32Array(mask.width)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x]) {
        rows[y] = (rows[y] ?? 0) + 1
        columns[x] = (columns[x] ?? 0) + 1
      }
    }
  }

  const extent = (profile: Int32Array): { from: number; to: number } | null => {
    let peak = 0
    for (const value of profile) if (value > peak) peak = value
    if (peak === 0) return null
    // A tenth of the busiest line: enough to ignore a stray antialiased pixel,
    // low enough to keep the thin top of an ascender.
    const floor = Math.max(1, peak * 0.1)
    let from = 0
    while (from < profile.length && (profile[from] ?? 0) < floor) from++
    let to = profile.length - 1
    while (to > from && (profile[to] ?? 0) < floor) to--
    return from <= to ? { from, to } : null
  }

  const vertical = extent(rows)
  const horizontal = extent(columns)
  if (!vertical || !horizontal) return region

  return {
    x: area.x + horizontal.from,
    y: area.y + vertical.from,
    w: horizontal.to - horizontal.from + 1,
    h: vertical.to - vertical.from + 1,
  }
}

/**
 * Where the ink of a line sits inside its em box, as a fraction of font size.
 *
 * These are the metrics almost every interface typeface agrees on to within a
 * few percent — Inter, Helvetica, system-ui, Geist, Roboto. They are what turns
 * a measured pixel height back into the `font-size` that produced it.
 */
export const METRICS = {
  ascender: 0.75,
  capHeight: 0.72,
  xHeight: 0.52,
  descender: 0.21,
} as const

const ASCENDER = /[A-Zbdfhkltß0-9(){}\[\]|\/\\@#$&*]/
const DESCENDER = /[gjpqyQ,;(){}\[\]|\/\\@]/

/**
 * Recover `font-size` from the height of the ink.
 *
 * The bounding box of a text run does not measure the font — it measures which
 * letters happen to be in it. "Come on" is shorter than "Coming" in the same
 * face at the same size, because the second has a descender. Reading the string
 * first and picking the right span is the difference between a type scale that
 * is right and one that is consistently a few pixels out.
 */
export function estimateFontSize(inkHeight: number, text: string): number {
  const span = spanFor(text)
  return inkHeight / span
}

export function spanFor(text: string): number {
  const hasAscender = ASCENDER.test(text)
  const hasDescender = DESCENDER.test(text)

  if (hasAscender && hasDescender) return METRICS.ascender + METRICS.descender
  if (hasAscender) return METRICS.ascender
  if (hasDescender) return METRICS.xHeight + METRICS.descender
  return METRICS.xHeight
}

/**
 * Median horizontal stroke thickness inside a region, in pixels.
 *
 * Runs of ink across a row are stems and bars. Their median is the stroke
 * width, and stroke width over font size is weight — the one typographic
 * property that a person reading a screenshot always guesses and always gets
 * slightly wrong.
 */
export function strokeWidth(ink: Mask, region: Box): number {
  const area = clamp(region, ink)
  const runs: number[] = []

  for (let y = area.y; y < area.y + area.h; y++) {
    let run = 0
    for (let x = area.x; x < area.x + area.w; x++) {
      if (ink.data[y * ink.width + x]) {
        run++
      } else if (run > 0) {
        runs.push(run)
        run = 0
      }
    }
    if (run > 0) runs.push(run)
  }

  if (runs.length === 0) return 0
  runs.sort((a, b) => a - b)
  // Discard the longest tenth: crossbars and underlines are not stems.
  const usable = runs.slice(0, Math.max(1, Math.round(runs.length * 0.9)))

  // The mean, not the median, and deliberately not rounded. A run length is a
  // whole number of pixels, so at 15px type the median is 1 or 2 and nothing
  // between — a 100% step across the entire range that separates regular from
  // bold. Averaging recovers the fraction: the same 15px regular text that
  // measured a median of 1 and 2 on two different words averages 1.4 on both.
  const total = usable.reduce((sum, run) => sum + run, 0)
  return total / usable.length
}

/**
 * The weights this can actually tell apart.
 *
 * Four steps, not the usual nine, because four is what the measurement
 * supports. On the known fixture, true 600 measured a stroke ratio of
 * 0.16–0.18 and true 700 measured 0.149–0.167: they overlap, and no threshold
 * placed between them would be anything but a coin toss dressed up as a
 * reading. Regular against bold, by contrast, is unambiguous — 0.10 against
 * 0.17, with nothing in between.
 *
 * Emitting 600 here would look more precise and be less true.
 */
export const WEIGHTS = [300, 400, 500, 700] as const
export type Weight = (typeof WEIGHTS)[number]

/**
 * Stroke width over font size, mapped onto the weights above.
 *
 * Thresholds fitted to the fixture: every one of its five regular runs landed
 * between 0.096 and 0.117, and every bold and semibold run between 0.149 and
 * 0.183.
 */
export function estimateWeight(stroke: number, fontSize: number): Weight {
  if (fontSize <= 0 || stroke <= 0) return 400
  const ratio = stroke / fontSize

  if (ratio < 0.082) return 300
  if (ratio < 0.128) return 400
  if (ratio < 0.145) return 500
  return 700
}

export interface Step {
  /** Rounded font size in pixels. */
  size: number
  /** How many text runs landed on this step. */
  count: number
}

/**
 * Collapse measured sizes into a type scale.
 *
 * Real pages use a handful of sizes; measurement noise turns those into dozens
 * of near-misses. Sizes within `tolerance` of each other are the same step, and
 * the step takes the count-weighted mean rather than the first value it saw.
 */
export function buildScale(sizes: readonly number[], tolerance = 0.06): Step[] {
  const sorted = [...sizes].filter(s => s > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return []

  const clusters: { total: number; count: number }[] = []
  for (const size of sorted) {
    const last = clusters[clusters.length - 1]
    const mean = last ? last.total / last.count : 0
    if (last && Math.abs(size - mean) <= mean * tolerance) {
      last.total += size
      last.count++
    } else {
      clusters.push({ total: size, count: 1 })
    }
  }

  return clusters
    .map(c => ({ size: Math.round(c.total / c.count), count: c.count }))
    .sort((a, b) => b.size - a.size)
}

export type TextRole = 'display' | 'heading' | 'subheading' | 'body' | 'label' | 'caption'

/**
 * The body size is the one the most text is set in, not the smallest and not
 * the most common step — a page with a long footer has a lot of fine print, and
 * fine print is not the body.
 */
export function bodySize(scale: readonly Step[]): number {
  if (scale.length === 0) return 16
  const plausible = scale.filter(s => s.size >= 12 && s.size <= 22)
  const pool = plausible.length > 0 ? plausible : scale
  return pool.reduce((best, s) => (s.count > best.count ? s : best), pool[0] as Step).size
}

/** Assign a role from size alone. Position and context refine this later. */
export function roleForSize(size: number, body: number): TextRole {
  const ratio = size / Math.max(1, body)
  if (ratio >= 2.6) return 'display'
  if (ratio >= 1.7) return 'heading'
  if (ratio >= 1.25) return 'subheading'
  if (ratio >= 0.94) return 'body'
  if (ratio >= 0.78) return 'label'
  return 'caption'
}

/** Round to the nearest sensible CSS value so the stylesheet reads like one a person wrote. */
export function tidySize(size: number): number {
  if (size <= 24) return Math.round(size)
  if (size <= 48) return Math.round(size / 2) * 2
  return Math.round(size / 4) * 4
}
