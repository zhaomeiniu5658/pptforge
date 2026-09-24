import { type Rgb, distance } from '../core/colour.js'
import { type Box } from '../core/geom.js'
import { at, type Raster } from '../core/image.js'

export interface Frame {
  /** The page inside the frame. Equals the whole image when there is no frame. */
  content: Box
  /** The frame colour, when one was found. */
  colour: Rgb | null
  thickness: { top: number; right: number; bottom: number; left: number }
}

/**
 * Strip the window frame from a screenshot.
 *
 * Screenshots taken with the macOS window shortcut come wrapped in the window's
 * own border and rounded corners, and on a dark theme that border is a solid
 * band of colour on all four sides. Left in, it is the single most destructive
 * thing in the image: it spans the full width, so no row of the page is ever
 * empty, which means no section boundary is ever found and the content column
 * measures as the entire canvas.
 *
 * Measured on a real capture the band was nine pixels of `#090b0a`, and every
 * section boundary above the fold was lost to it.
 */
export function detectFrame(raster: Raster, options: { minShare?: number; maxFraction?: number } = {}): Frame {
  const minShare = options.minShare ?? 0.9
  const maxFraction = options.maxFraction ?? 0.12

  const none: Frame = {
    content: { x: 0, y: 0, w: raster.width, h: raster.height },
    colour: null,
    thickness: { top: 0, right: 0, bottom: 0, left: 0 },
  }
  if (raster.width < 40 || raster.height < 40) return none

  // All four corners must agree, otherwise this is a design that happens to
  // have a dark top edge rather than a window border.
  const corners = [
    at(raster, 0, 0),
    at(raster, raster.width - 1, 0),
    at(raster, 0, raster.height - 1),
    at(raster, raster.width - 1, raster.height - 1),
  ]
  const colour = corners[0] as Rgb
  if (corners.some(c => distance(c, colour) > 10)) return none

  const isFrame = (c: Rgb): boolean => distance(c, colour) < 12

  const rowShare = (y: number): number => {
    let hits = 0
    const step = Math.max(1, Math.round(raster.width / 200))
    let seen = 0
    for (let x = 0; x < raster.width; x += step) {
      seen++
      if (isFrame(at(raster, x, y))) hits++
    }
    return seen === 0 ? 0 : hits / seen
  }
  const columnShare = (x: number): number => {
    let hits = 0
    const step = Math.max(1, Math.round(raster.height / 200))
    let seen = 0
    for (let y = 0; y < raster.height; y += step) {
      seen++
      if (isFrame(at(raster, x, y))) hits++
    }
    return seen === 0 ? 0 : hits / seen
  }

  const limitY = Math.floor(raster.height * maxFraction)
  const limitX = Math.floor(raster.width * maxFraction)

  let top = 0
  while (top < limitY && rowShare(top) >= minShare) top++
  let bottom = 0
  while (bottom < limitY && rowShare(raster.height - 1 - bottom) >= minShare) bottom++
  let left = 0
  while (left < limitX && columnShare(left) >= minShare) left++
  let right = 0
  while (right < limitX && columnShare(raster.width - 1 - right) >= minShare) right++

  if (top === 0 && bottom === 0 && left === 0 && right === 0) return none

  // The corner is an arc, not a right angle, so a couple of pixels of it
  // survive the straight-edge scan. Taking one extra pixel costs nothing and
  // removes four stray marks that would otherwise be read as icons.
  const bleed = 1
  top = top > 0 ? top + bleed : 0
  bottom = bottom > 0 ? bottom + bleed : 0
  left = left > 0 ? left + bleed : 0
  right = right > 0 ? right + bleed : 0

  const content: Box = {
    x: left,
    y: top,
    w: raster.width - left - right,
    h: raster.height - top - bottom,
  }
  if (content.w < raster.width * 0.5 || content.h < raster.height * 0.5) return none

  /**
   * A frame has to be a different colour from the page it frames.
   *
   * Without this check the detector eats page margins. A centred layout on a
   * white background has two hundred pixels of pure white down each side, which
   * satisfies every "is this a uniform border" test there is — so it gets
   * cropped, and the gutter and container measurements, which are precisely the
   * width of what was just thrown away, come back as zero. Measured on the test
   * fixture it removed 289px per side and reported a 1040px content column as
   * 862px with no gutter at all.
   */
  const interior = interiorColour(raster, content)
  if (distance(interior, colour) < 12) return none

  return { content, colour, thickness: { top, right, bottom, left } }
}

/** The dominant colour just inside the candidate frame. */
function interiorColour(raster: Raster, content: Box): Rgb {
  const counts = new Map<number, { colour: Rgb; count: number }>()
  const stepX = Math.max(1, Math.round(content.w / 60))
  const stepY = Math.max(1, Math.round(content.h / 60))

  for (let y = content.y; y < content.y + content.h; y += stepY) {
    for (let x = content.x; x < content.x + content.w; x += stepX) {
      const pixel = at(raster, x, y)
      const key = ((pixel.r >> 3) << 10) | ((pixel.g >> 3) << 5) | (pixel.b >> 3)
      const existing = counts.get(key)
      if (existing) existing.count++
      else counts.set(key, { colour: pixel, count: 1 })
    }
  }

  let best: { colour: Rgb; count: number } | null = null
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry
  return best?.colour ?? { r: 255, g: 255, b: 255 }
}

export const hasFrame = (frame: Frame): boolean =>
  frame.thickness.top + frame.thickness.right + frame.thickness.bottom + frame.thickness.left > 0
