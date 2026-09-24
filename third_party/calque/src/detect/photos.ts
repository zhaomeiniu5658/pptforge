import { type Rgb, distance } from '../core/colour.js'
import { type Box, right, bottom } from '../core/geom.js'
import { at, type Raster } from '../core/image.js'

export interface PhotoRegion extends Box {
  /** Mean colour, for the placeholder when the crop is not wanted. */
  averageColour: Rgb
  /** Share of the page this covers, 0–1. */
  coverage: number
}

export interface PhotoOptions {
  /** Grid size in pixels. */
  cell?: number
  /** Distinct colours in a cell before it counts as photographic. */
  minColours?: number
  /** Smallest region worth reporting, as a share of the page. */
  minCoverage?: number
}

/**
 * Find the parts of the image that are photographs rather than interface.
 *
 * The discriminator is how many distinct colours a small tile contains, not how
 * much it varies. Variance alone flags text as strongly as it flags a
 * photograph — a word is a violent light-to-dark transition every few pixels.
 * But text is *bimodal*: however sharp the edges, the tile holds two colours
 * and their blends. A photograph of a beach holds dozens. Counting buckets
 * separates them cleanly where measuring contrast does not.
 *
 * This matters more than it sounds. A full-bleed hero photograph is not a
 * detail of a page, it *is* the page, and without this the rebuild of one is a
 * blank white screen with some text on it — measured at 1.9% of pixels matching
 * on a real site.
 */
export function photoRegions(raster: Raster, options: PhotoOptions = {}): PhotoRegion[] {
  const cell = options.cell ?? 24
  const minColours = options.minColours ?? 12
  const minCoverage = options.minCoverage ?? 0.02

  const across = Math.max(1, Math.floor(raster.width / cell))
  const down = Math.max(1, Math.floor(raster.height / cell))
  const photographic = new Uint8Array(across * down)

  for (let row = 0; row < down; row++) {
    for (let column = 0; column < across; column++) {
      const buckets = new Set<number>()
      const x0 = column * cell
      const y0 = row * cell
      // Every third pixel: enough to count colours, a ninth of the work.
      for (let y = y0; y < Math.min(y0 + cell, raster.height); y += 3) {
        for (let x = x0; x < Math.min(x0 + cell, raster.width); x += 3) {
          const p = at(raster, x, y)
          buckets.add(((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4))
        }
      }
      if (buckets.size >= minColours) photographic[row * across + column] = 1
    }
  }

  // Connected components over the cell grid, then back to pixel coordinates.
  const seen = new Uint8Array(photographic.length)
  const regions: PhotoRegion[] = []
  const stack: number[] = []

  for (let start = 0; start < photographic.length; start++) {
    if (!photographic[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1

    let minColumn = start % across
    let maxColumn = minColumn
    let minRow = Math.floor(start / across)
    let maxRow = minRow
    let cells = 0

    while (stack.length > 0) {
      const index = stack.pop() as number
      const column = index % across
      const row = Math.floor(index / across)
      cells++
      if (column < minColumn) minColumn = column
      if (column > maxColumn) maxColumn = column
      if (row < minRow) minRow = row
      if (row > maxRow) maxRow = row

      const neighbours = [
        column > 0 ? index - 1 : -1,
        column < across - 1 ? index + 1 : -1,
        row > 0 ? index - across : -1,
        row < down - 1 ? index + across : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && photographic[n] && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }

    const box: Box = {
      x: minColumn * cell,
      y: minRow * cell,
      w: Math.min(raster.width - minColumn * cell, (maxColumn - minColumn + 1) * cell),
      h: Math.min(raster.height - minRow * cell, (maxRow - minRow + 1) * cell),
    }
    const coverage = (box.w * box.h) / (raster.width * raster.height)
    if (coverage < minCoverage) continue

    // A sparse scatter of busy cells is texture or noise, not a picture.
    const filled = cells / Math.max(1, (maxColumn - minColumn + 1) * (maxRow - minRow + 1))
    if (filled < 0.55) continue

    regions.push({ ...box, averageColour: meanColour(raster, box), coverage })
  }

  return regions
    .map(region => snapToEdges(region, raster))
    .sort((a, b) => b.coverage - a.coverage)
}

/**
 * Extend a full-width picture out to the edges it very nearly reaches.
 *
 * The colour-count test measures texture, and the calm parts of a photograph
 * have none: an expanse of sky holds three or four shades and reads as flat
 * interface. So a full-bleed hero is detected from its horizon down, and the
 * sky above it becomes a separate section — which on a real page pushed the
 * whole rebuild 98px down the screen and put a grey bar where the sunrise was.
 *
 * A picture that already spans the width of the page and comes within a short
 * distance of an edge was always going to that edge.
 */
export function snapToEdges(region: PhotoRegion, page: { width: number; height: number }, reach = 0.3): PhotoRegion {
  if (region.w < page.width * 0.9) return region

  const near = Math.round(page.height * reach)
  const top = region.y <= near ? 0 : region.y
  const base = page.height - bottom(region) <= near ? page.height : bottom(region)

  const snapped: Box = { x: 0, y: top, w: page.width, h: base - top }
  return {
    ...region,
    ...snapped,
    coverage: (snapped.w * snapped.h) / (page.width * page.height),
  }
}

export function meanColour(raster: Raster, box: Box): Rgb {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const step = Math.max(1, Math.round(Math.sqrt((box.w * box.h) / 4000)))
  for (let y = box.y; y < bottom(box) && y < raster.height; y += step) {
    for (let x = box.x; x < right(box) && x < raster.width; x += step) {
      const p = at(raster, x, y)
      r += p.r
      g += p.g
      b += p.b
      n++
    }
  }
  return n === 0 ? { r: 128, g: 128, b: 128 } : { r: r / n, g: g / n, b: b / n }
}

/** How much of `band` this one region covers, 0–1. */
export function bandCoverage(photo: Box, band: Box): number {
  const x = Math.max(photo.x, band.x)
  const y = Math.max(photo.y, band.y)
  const w = Math.min(right(photo), right(band)) - x
  const h = Math.min(bottom(photo), bottom(band)) - y
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.max(1, band.w * band.h)
}

/**
 * Is this band sitting on a photograph?
 *
 * Summed over every region, not tested one at a time. A photograph with a
 * headline across it is not detected as one picture — the type splits it into
 * a piece above and a piece below — so each half falls under any sensible
 * single-region threshold and a full-bleed hero registers as no backdrop at
 * all. The pieces are the same picture and they count together.
 *
 * Slightly over-counts where two regions overlap, which is the harmless
 * direction: the answer is only used to decide whether to paint the band.
 */
export function coversBand(photos: readonly Box[], band: Box, minShare = 0.55): boolean {
  const total = photos.reduce((sum, photo) => sum + bandCoverage(photo, band), 0)
  return total >= minShare
}

/** Text sitting on a photograph needs a colour that survives whatever is under it. */
export function isOverPhoto(region: Box, photos: readonly PhotoRegion[]): boolean {
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  return photos.some(p => cx >= p.x && cx < right(p) && cy >= p.y && cy < bottom(p))
}

export const photoDistance = distance
