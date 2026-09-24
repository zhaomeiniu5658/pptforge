import { type Rgb, distance } from '../core/colour.js'
import { type Box, bottom, centreX, right } from '../core/geom.js'
import { at, type Raster } from '../core/image.js'
import { type Mask, columnProfile, rowProfile, runsBelow } from '../core/mask.js'
import { quantise } from './palette.js'

/**
 * The block the page's content actually occupies.
 *
 * Gives both the container width and the page gutter, which together are most
 * of what makes a rebuild feel like the original at a glance. Guessing 1200px
 * when the design used 1120px is visible immediately.
 */
export function contentBox(regions: readonly Box[], page: { width: number; height: number }): Box {
  // Measured from the elements that survived segmentation, not from raw ink.
  // Raw ink still holds the last pixel of an antialiased window corner and a
  // scrollbar hairline, and either one on its own reports the content column as
  // the full width of the canvas — which then propagates into `container` and
  // makes every rebuilt page edge to edge.
  const real = regions.filter(r => r.w >= 3 && r.h >= 3)
  if (real.length === 0) return { x: 0, y: 0, w: page.width, h: page.height }

  // Trimmed extremes rather than the outright minimum and maximum. One stray
  // mark decides the answer otherwise, and there is always one: a framework's
  // development badge pinned to the bottom corner, the last antialiased pixel
  // of a window arc, a scrollbar. Each of those on its own reported this page's
  // content column as the full 1578px canvas instead of the 1510px it uses.
  const edge = (values: number[], fraction: number): number => {
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
    return sorted[index] as number
  }

  const trim = real.length >= 12 ? 0.03 : 0
  const x0 = edge(real.map(r => r.x), trim)
  const x1 = edge(real.map(r => right(r)), 1 - trim)
  const y0 = edge(real.map(r => r.y), 0)
  const y1 = edge(real.map(r => bottom(r)), 1)

  return {
    x: Math.max(0, x0),
    y: Math.max(0, y0),
    w: Math.max(1, Math.min(page.width, x1) - Math.max(0, x0)),
    h: Math.max(1, Math.min(page.height, y1) - Math.max(0, y0)),
  }
}

/**
 * The background colour of each row, sampled at the page edges.
 *
 * Content lives in the middle, so the outer margins are the most reliable read
 * on what colour the row's section is painted.
 */
export function rowBackgrounds(raster: Raster): Rgb[] {
  const edge = Math.max(2, Math.round(raster.width * 0.02))
  const step = Math.max(1, Math.round(edge / 8))
  const out: Rgb[] = []

  for (let y = 0; y < raster.height; y++) {
    const pixels: Rgb[] = []
    for (let x = 0; x < edge; x += step) pixels.push(at(raster, x, y))
    for (let x = raster.width - edge; x < raster.width; x += step) pixels.push(at(raster, x, y))
    out.push(quantise(pixels, 2, 6)[0]?.colour ?? { r: 255, g: 255, b: 255 })
  }
  return out
}

/**
 * Rows where the page changes colour.
 *
 * Half the sections on a real page are not separated by whitespace at all —
 * they are separated by the background going from white to grey. A gap-only
 * segmenter merges them into one enormous band and the rebuild loses every
 * section boundary below the fold.
 */
export function colourBoundaries(
  backgrounds: readonly Rgb[],
  minDelta = 10,
  window = 12,
): number[] {
  if (backgrounds.length < window * 2 + 1) return []

  // Compare the average of the rows above against the average of the rows
  // below. Comparing a row to the one before it instead — which is the obvious
  // way to write this — finds a boundary everywhere on a gradient, because a
  // gradient plus a little compression noise clears any per-row threshold. Over
  // a window the gradient contributes almost nothing and a real step survives
  // whole. On a page with a radial glow behind the hero this was the difference
  // between nineteen sections and six.
  const strength = new Float64Array(backgrounds.length)
  for (let y = window; y < backgrounds.length - window; y++) {
    const above = meanColour(backgrounds, y - window, y)
    const below = meanColour(backgrounds, y, y + window)
    strength[y] = distance(above, below)
  }

  const boundaries: number[] = []
  for (let y = window; y < backgrounds.length - window; y++) {
    const here = strength[y] ?? 0
    if (here <= minDelta) continue

    // Keep only the strongest row of each step, or one edge yields a dozen.
    let peak = true
    for (let k = Math.max(0, y - window); k < Math.min(strength.length, y + window + 1); k++) {
      if ((strength[k] ?? 0) > here) { peak = false; break }
    }
    if (!peak) continue
    if (boundaries.length > 0 && y - (boundaries[boundaries.length - 1] as number) < window) continue
    boundaries.push(y)
  }
  return boundaries
}

function meanColour(colours: readonly Rgb[], from: number, to: number): Rgb {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = from; i < to; i++) {
    const c = colours[i]
    if (!c) continue
    r += c.r
    g += c.g
    b += c.b
    n++
  }
  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n, g: g / n, b: b / n }
}

export interface Band extends Box {
  /** Why this band starts where it does. */
  boundary: 'gap' | 'colour' | 'edge'
  background: Rgb
}

export interface BandOptions {
  /** A vertical gap this tall or taller separates two sections. */
  minGap?: number
  /** Ink per row at or below this counts as empty. */
  floor?: number
}

/**
 * Split the page into horizontal sections, using whitespace and colour changes
 * together.
 */
export function bands(
  ink: Mask,
  raster: Raster,
  elements: readonly Box[] = [],
  options: BandOptions = {},
): Band[] {
  const minGap = options.minGap ?? sectionGap(elements, ink.height)
  const floor = options.floor ?? Math.max(1, Math.round(ink.width * 0.0015))

  const profile = rowProfile(ink)
  const gaps = runsBelow(profile, floor, minGap)

  const backgrounds = rowBackgrounds(raster)
  const colourCuts = colourBoundaries(backgrounds)

  /**
   * A section boundary cannot pass through an element.
   *
   * The strongest available constraint, and it costs one comparison. A glow
   * behind a hero shifts the measured background enough to look like a step
   * change, and without this the cut lands in the middle of the headline and
   * splits one line of type across two sections. Nothing that is one element
   * can be in two sections, whatever the colour says.
   */
  const splitsAnElement = (y: number): boolean =>
    elements.some(e => y > e.y + 1 && y < bottom(e) - 1)

  // A cut at the middle of each empty stretch, plus every colour change.
  const cuts = new Set<number>([0, ink.height])
  const reason = new Map<number, 'gap' | 'colour'>()

  for (const gap of gaps) {
    if (gap.start === 0 || gap.end === ink.height) continue
    const middle = Math.round((gap.start + gap.end) / 2)
    cuts.add(middle)
    reason.set(middle, 'gap')
  }
  for (const cut of colourCuts) {
    // A colour change inside a whitespace gap is the same boundary twice.
    if ([...cuts].some(existing => Math.abs(existing - cut) < minGap / 2)) continue
    if (splitsAnElement(cut)) continue
    cuts.add(cut)
    reason.set(cut, 'colour')
  }

  const ordered = [...cuts].sort((a, b) => a - b)
  const out: Band[] = []

  for (let i = 0; i < ordered.length - 1; i++) {
    const start = ordered[i] as number
    const end = ordered[i + 1] as number
    if (end - start < 8) continue

    // A band with no ink at all is a spacer, not a section.
    let hasInk = false
    for (let y = start; y < end && !hasInk; y++) if ((profile[y] ?? 0) > floor) hasInk = true
    if (!hasInk) continue

    const middle = backgrounds[Math.floor((start + end) / 2)] ?? { r: 255, g: 255, b: 255 }
    out.push({
      x: 0,
      y: start,
      w: ink.width,
      h: end - start,
      boundary: reason.get(start) ?? 'edge',
      background: middle,
    })
  }

  return out
}

/**
 * How large a vertical gap has to be before it separates two sections.
 *
 * Measured from the page rather than fixed, because "a big gap" only means
 * anything relative to the gaps a particular design already uses. A fixed
 * 26px threshold split this fixture's hero into three sections — headline,
 * subtitle and button each became their own — because the 30px of breathing
 * room *inside* the hero cleared the same bar as the 109px between sections.
 *
 * Taking a multiple of the page's own median gap makes the test scale with the
 * design: on a dense page a 40px gap is a section break, on an airy one it is
 * just the space under a heading.
 */
export function sectionGap(elements: readonly Box[], pageHeight: number): number {
  const floor = Math.max(24, Math.round(pageHeight * 0.02))
  const gaps = verticalGaps(elements).filter(g => g > 0)
  if (gaps.length < 4) return floor

  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return Math.max(floor, Math.round(median * 2.2))
}

export interface Column extends Box {}

/**
 * Vertical gutters inside a band become columns.
 *
 * The gutter has to be wide relative to the band, otherwise the spaces between
 * words in a headline read as a twelve-column grid.
 */
export function columns(ink: Mask, band: Box, minGutter?: number): Column[] {
  const gutter = minGutter ?? Math.max(18, Math.round(band.w * 0.02))
  const profile = columnProfile(ink, band)
  const empty = runsBelow(profile, 0, gutter)

  const filled: Column[] = []
  let cursor = 0
  for (const run of empty) {
    if (run.start > cursor) {
      filled.push({ x: band.x + cursor, y: band.y, w: run.start - cursor, h: band.h })
    }
    cursor = run.end
  }
  if (cursor < profile.length) {
    filled.push({ x: band.x + cursor, y: band.y, w: profile.length - cursor, h: band.h })
  }

  return filled.filter(c => c.w > gutter / 2)
}

export type Alignment = 'left' | 'centre' | 'right' | 'justify'

/**
 * How a stack of boxes lines up inside its container.
 *
 * Compares the spread of the left edges, the right edges and the centres, and
 * takes the tightest. Centred text rebuilt as left-aligned is the single most
 * obvious way a reconstruction looks wrong.
 */
export function alignmentOf(boxes: readonly Box[], container: Box): Alignment {
  if (boxes.length === 0) return 'left'
  if (boxes.length === 1) {
    const only = boxes[0] as Box
    const leftGap = only.x - container.x
    const rightGap = right(container) - right(only)
    const spread = Math.abs(leftGap - rightGap)
    // A single line is centred when its margins match to within a few percent.
    if (spread < container.w * 0.04 && leftGap > container.w * 0.06) return 'centre'
    return rightGap < leftGap * 0.4 ? 'right' : 'left'
  }

  const lefts = boxes.map(b => b.x)
  const rights = boxes.map(b => right(b))
  const centres = boxes.map(b => centreX(b))

  const byLeft = spread(lefts)
  const byRight = spread(rights)
  const byCentre = spread(centres)

  const best = Math.min(byLeft, byRight, byCentre)
  // Both edges tight means the block fills its container.
  if (byLeft < container.w * 0.01 && byRight < container.w * 0.01) return 'justify'
  if (best === byCentre) return 'centre'
  if (best === byRight) return 'right'
  return 'left'
}

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)
}

/** Vertical gaps between consecutive boxes, which become margins in the rebuild. */
export function verticalGaps(boxes: readonly Box[]): number[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1] as Box
    const current = sorted[i] as Box
    gaps.push(current.y - bottom(previous))
  }
  return gaps
}

/**
 * The spacing unit the design was built on.
 *
 * Most pages are laid out on a 4 or 8 pixel rhythm. Finding it lets the
 * stylesheet round to that rhythm instead of emitting `margin-bottom: 27px`.
 */
export function spacingUnit(gaps: readonly number[]): number {
  const positive = gaps.filter(g => g > 2 && g < 400)
  if (positive.length < 3) return 8

  let best = 8
  let bestScore = -1
  // Largest first, and ties go to the one already held. Every gap that lands on
  // an 8px rhythm also lands on a 4px one, so testing upwards always answers 4
  // — technically true and useless, since it describes every page ever laid
  // out. The largest unit that still explains the spacing is the one the design
  // was actually built on.
  for (const unit of [12, 10, 8, 6, 4]) {
    const score = positive.reduce((sum, gap) => {
      const remainder = gap % unit
      const off = Math.min(remainder, unit - remainder)
      return sum + (off <= 1 ? 1 : 0)
    }, 0)
    if (score > bestScore) {
      bestScore = score
      best = unit
    }
  }
  return best
}
