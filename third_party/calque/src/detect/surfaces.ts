import { type Rgb, distance } from '../core/colour.js'
import { type Box, bottom, clamp, right } from '../core/geom.js'
import { at, type Raster } from '../core/image.js'
import { quantise } from './palette.js'

export interface Surface extends Box {
  fill: Rgb
  /** Border radius in pixels, 0 for square corners. */
  radius: number
  border: { colour: Rgb; width: number } | null
}

/**
 * The fraction of a corner square that a rounded corner leaves unpainted.
 *
 * A quarter disc of radius r covers πr²/4 of the r × r corner square, so the
 * missing area is r²(1 − π/4). Counting unpainted pixels and inverting that is
 * far steadier than tracing the curve, because it averages over the whole
 * antialiased edge instead of depending on where a threshold happens to fall.
 */
export const CORNER_CONSTANT = 1 - Math.PI / 4

export function radiusFromMissing(missingPixels: number): number {
  return Math.sqrt(Math.max(0, missingPixels) / CORNER_CONSTANT)
}

/** Is this pixel painted in the surface colour? */
const matches = (raster: Raster, x: number, y: number, fill: Rgb, tolerance: number): boolean =>
  distance(at(raster, x, y), fill) <= tolerance

/**
 * Measure the corner radius of a filled box by counting how much of each corner
 * square is not filled, then averaging the four answers.
 */
/**
 * Measure the corner radius by walking down the side until the edge goes
 * straight.
 *
 * On a rounded rectangle of radius r, the leftmost filled pixel of the top row
 * sits r across from the left edge, and by r rows down it has reached the edge
 * and stays there. So the radius is simply how far down the side has to go
 * before it stops moving.
 *
 * This replaced a neater calculation — a quarter disc leaves r²(1 − π/4) of its
 * corner square unpainted, so counting unpainted pixels inverts straight to r —
 * which was far too sensitive to the panel's own bounds. Overshooting the panel
 * by nine pixels put nine rows of *page* inside the corner window, and a 12px
 * radius measured 28px; insetting to compensate then measured it as 4px. This
 * version finds the panel's real edges first and never depends on being handed
 * them exactly.
 */
export function cornerRadius(raster: Raster, box: Box, fill: Rgb, tolerance = 10): number {
  const area = clamp(box, raster)
  if (area.w < 6 || area.h < 6) return 0

  const covered = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < raster.width && y < raster.height && matches(raster, x, y, fill, tolerance)

  const rowHits = (y: number): number => {
    let hits = 0
    const step = Math.max(1, Math.round(area.w / 60))
    for (let x = area.x; x < right(area); x += step) if (covered(x, y)) hits++
    return hits
  }
  const columnHits = (x: number): number => {
    let hits = 0
    const step = Math.max(1, Math.round(area.h / 60))
    for (let y = area.y; y < bottom(area); y += step) if (covered(x, y)) hits++
    return hits
  }

  // The panel's true edges, ignoring any overshoot in the box handed in.
  let top = area.y
  while (top < bottom(area) - 1 && rowHits(top) === 0) top++
  let base = bottom(area) - 1
  while (base > top && rowHits(base) === 0) base--
  let left = area.x
  while (left < right(area) - 1 && columnHits(left) === 0) left++
  let rightSide = right(area) - 1
  while (rightSide > left && columnHits(rightSide) === 0) rightSide--

  const limit = Math.max(2, Math.min(Math.round(Math.min(rightSide - left, base - top) / 2), 40))

  /** How far down a side runs before its edge stops moving inward. */
  const measure = (fromY: number, stepY: number, edgeX: number, stepX: number): number | null => {
    for (let d = 0; d <= limit; d++) {
      const y = fromY + stepY * d
      if (covered(edgeX, y)) return d
    }
    return null
  }

  const radii = [
    measure(top, 1, left, 1),
    measure(top, 1, rightSide, -1),
    measure(base, -1, left, 1),
    measure(base, -1, rightSide, -1),
  ].filter((r): r is number => r !== null && r < limit)

  if (radii.length === 0) return 0
  radii.sort((a, b) => a - b)
  const median = radii[Math.floor(radii.length / 2)] ?? 0
  return median < 2 ? 0 : Math.round(median)
}

/**
 * Grow a filled rectangle outwards from a seed point.
 *
 * Scanline expansion rather than a flood fill: a card is a rectangle, and
 * asking "does the next row still match across most of its width" both finds
 * the edges and refuses to leak through a one pixel gap into the page behind.
 */
export function expandSurface(
  raster: Raster,
  seed: { x: number; y: number },
  fill: Rgb,
  tolerance = 10,
  /**
   * How much of a row must still be the fill colour for the panel to continue
   * through it.
   *
   * Set at 0.82 this stopped at the first line of text, because a row of type
   * on a card is only about three quarters fill — so a 130px card measured 38px
   * tall, ending exactly where its heading began.
   *
   * It has to go lower still than that suggests. The tolerance here is tight by
   * necessity, and antialiasing puts a halo of near-but-not-quite pixels around
   * every glyph, so the densest row of a paragraph counts barely half the card
   * as fill. A row outside the panel is 0% fill, not 50%, so the two cases are
   * nowhere near each other and the bar belongs between them rather than just
   * under the higher one.
   */
  minCoverage = 0.4,
): Box | null {
  if (!matches(raster, seed.x, seed.y, fill, tolerance)) return null

  let left = seed.x
  while (left > 0 && matches(raster, left - 1, seed.y, fill, tolerance)) left--
  let rightEdge = seed.x
  while (rightEdge < raster.width - 1 && matches(raster, rightEdge + 1, seed.y, fill, tolerance)) rightEdge++

  const width = rightEdge - left + 1
  if (width < 4) return null

  const rowCovered = (y: number, x0: number, x1: number): boolean => {
    if (y < 0 || y >= raster.height) return false
    let hits = 0
    const span = x1 - x0 + 1
    const step = Math.max(1, Math.round(span / 60))
    let checked = 0
    for (let x = x0; x <= x1; x += step) {
      checked++
      if (matches(raster, x, y, fill, tolerance)) hits++
    }
    return checked > 0 && hits / checked >= minCoverage
  }

  let top = seed.y
  while (top > 0 && rowCovered(top - 1, left, rightEdge)) top--
  let base = seed.y
  while (base < raster.height - 1 && rowCovered(base + 1, left, rightEdge)) base++

  return { x: left, y: top, w: width, h: base - top + 1 }
}

/**
 * Is the whole rectangle really one colour?
 *
 * The scanline expansion only ever compares a pixel to its seed, and on a
 * gradient every individual step is well inside tolerance while the total drift
 * is not — so it walks the entire background and reports it as a panel. On a
 * page with a green glow behind the hero this produced a single enormous card
 * covering the whole screen, with the headline lost inside it.
 *
 * Checking the far corners after the fact costs nine samples and cannot be
 * fooled by a gradient, because the question is asked about the distance that
 * actually accumulated rather than about each step.
 */
export function isUniform(raster: Raster, area: Box, fill: Rgb, tolerance: number): boolean {
  const xs = [area.x + 2, area.x + Math.round(area.w / 2), right(area) - 3]
  const ys = [area.y + 2, area.y + Math.round(area.h / 2), bottom(area) - 3]

  let checked = 0
  let agreed = 0
  for (const x of xs) {
    for (const y of ys) {
      if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue
      checked++
      // Generous here on purpose: the centre samples may land on type.
      if (distance(at(raster, x, y), fill) <= tolerance * 3 + 4) agreed++
    }
  }
  return checked > 0 && agreed / checked >= 0.78
}

/**
 * The panel a text run is sitting on, if it is sitting on one.
 *
 * `behind` is the colour measured between the glyphs of the run itself, so this
 * asks a precise question: is the colour immediately around this text different
 * from the colour of the section, and if so, how far does it extend?
 *
 * The threshold is low because real cards are subtle: a #f4f4f5 card on a
 * #fafafa section is a difference of about 2.4 in Lab, which is most of a
 * design system's idea of elevation and is almost invisible in isolation.
 */
export function surfaceUnder(
  raster: Raster,
  region: Box,
  behind: Rgb,
  sectionBackground: Rgb,
  options: { minDelta?: number; tolerance?: number } = {},
): Surface | null {
  const minDelta = options.minDelta ?? 2
  const delta = distance(behind, sectionBackground)

  // Same colour as the section means there is no panel, only the page.
  if (delta < minDelta) return null

  /**
   * The match tolerance has to be tighter than the difference being detected.
   *
   * A fixed tolerance defeats itself on exactly the cards worth finding: a
   * #f4f4f5 card on a #fafafa section differs by 2.4 in Lab, so a tolerance of
   * 10 counts the section as part of the card and the region grows until it is
   * the whole band. Scaling the tolerance to the gap keeps the two apart.
   */
  const tolerance = options.tolerance ?? Math.max(1.2, Math.min(10, delta * 0.6))

  const middleX = Math.round(region.x + region.w / 2)
  const middleY = Math.round(region.y + region.h / 2)

  /**
   * Seed above and below the text, not level with it.
   *
   * The scan runs along its seed row first. Started on a row that contains the
   * text, it stops at the first letter it meets, so the panel measures from its
   * left edge to the start of the word — a 325px card came back 204px wide,
   * which then made the padding compute as zero and put the text hard against
   * the corner. The rows just outside the type are clear all the way across.
   */
  const candidates = [
    { x: middleX, y: region.y - 3 },
    { x: middleX, y: bottom(region) + 3 },
    { x: middleX, y: region.y - 8 },
    { x: middleX, y: bottom(region) + 8 },
    { x: region.x - 3, y: middleY },
    { x: right(region) + 2, y: middleY },
  ].filter(p => p.x >= 0 && p.y >= 0 && p.x < raster.width && p.y < raster.height)

  /**
   * Expand on the colour actually present at the seed, not on the estimate.
   *
   * `behind` comes from the region's histogram, which includes antialiased
   * pixels from the type sitting on the panel, so it lands a shade or two off:
   * a #f4f4f5 card measured #f2f2f3. That is nothing on its own, but the
   * tolerance here has to be tighter than the card-to-section difference, and
   * on a subtle card that difference is itself only about 2.4 — so an estimate
   * two units out is the whole budget, and the scan dies at its own seed.
   * Reading the pixel removes the estimate from the loop.
   */
  let best: { box: Box; fill: Rgb } | null = null
  for (const start of candidates) {
    const seedColour = at(raster, start.x, start.y)
    if (distance(seedColour, sectionBackground) < minDelta) continue
    if (distance(seedColour, behind) > Math.max(6, delta)) continue

    const found = expandSurface(raster, start, seedColour, tolerance)
    if (!found) continue
    if (found.w < region.w * 0.9) continue
    if (found.w >= raster.width * 0.995 && found.h >= raster.height * 0.995) continue
    if (!isUniform(raster, found, seedColour, tolerance)) continue
    if (!best || found.w * found.h > best.box.w * best.box.h) best = { box: found, fill: seedColour }
  }
  if (!best) return null

  return {
    ...best.box,
    fill: best.fill,
    radius: cornerRadius(raster, best.box, best.fill, tolerance),
    border: detectBorder(raster, best.box, best.fill, tolerance),
  }
}

/**
 * A ring of a different colour just inside the edge of a panel.
 *
 * Sampled one pixel in from the boundary, because the outermost pixel is
 * antialiased against whatever is behind the panel and never reads as a clean
 * border colour.
 */
export function detectBorder(
  raster: Raster,
  area: Box,
  fill: Rgb,
  tolerance = 10,
): { colour: Rgb; width: number } | null {
  const region = clamp(area, raster)
  if (region.w < 6 || region.h < 6) return null

  const ring: Rgb[] = []
  const step = Math.max(1, Math.round(region.w / 40))
  for (let x = region.x + 2; x < right(region) - 2; x += step) {
    ring.push(at(raster, x, region.y + 1))
    ring.push(at(raster, x, bottom(region) - 2))
  }
  const vstep = Math.max(1, Math.round(region.h / 20))
  for (let y = region.y + 2; y < bottom(region) - 2; y += vstep) {
    ring.push(at(raster, region.x + 1, y))
    ring.push(at(raster, right(region) - 2, y))
  }
  if (ring.length === 0) return null

  const dominant = quantise(ring, 2, 8)[0]
  if (!dominant) return null
  if (distance(dominant.colour, fill) <= tolerance) return null
  // A border is a thin ring, not a second panel: most of the edge must be it.
  if (dominant.share < 0.6) return null

  return { colour: dominant.colour, width: 1 }
}

/**
 * A panel small enough, and tight enough around its label, to be a control
 * rather than a card.
 */
export function looksLikeButton(surface: Surface, text: Box, page: { width: number }): boolean {
  const padding = surface.w - text.w
  return (
    surface.h <= 76 &&
    surface.w <= page.width * 0.45 &&
    padding >= 8 &&
    padding <= surface.w * 0.75 &&
    surface.h >= text.h * 1.4
  )
}
