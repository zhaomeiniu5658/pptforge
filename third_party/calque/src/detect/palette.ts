import { type Rgb, contrast, distance, isDark, luminance, mix, rgb, saturation } from '../core/colour.js'
import { type Box, clamp } from '../core/geom.js'
import { at, type Raster, samples } from '../core/image.js'
import { type Mask } from '../core/mask.js'

export interface Swatch {
  colour: Rgb
  /** Fraction of the sampled pixels this swatch accounts for, 0–1. */
  share: number
}

/**
 * Frequency clustering in a coarse colour grid, then a merge pass in Lab.
 *
 * Cheaper than k-means and more stable: k-means on a photograph gives a
 * different answer every run, and the palette of a web page has to be the same
 * on Tuesday as it was on Monday.
 */
export function quantise(pixels: readonly Rgb[], maxSwatches = 8, mergeBelow = 12): Swatch[] {
  if (pixels.length === 0) return []

  const buckets = new Map<number, { sum: [number, number, number]; count: number }>()
  for (const p of pixels) {
    // Five bits a channel: fine enough to keep two greys apart, coarse enough
    // that antialiasing does not become its own colour.
    const key = ((p.r >> 3) << 10) | ((p.g >> 3) << 5) | (p.b >> 3)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.sum[0] += p.r
      bucket.sum[1] += p.g
      bucket.sum[2] += p.b
      bucket.count++
    } else {
      buckets.set(key, { sum: [p.r, p.g, p.b], count: 1 })
    }
  }

  const ranked = [...buckets.values()]
    .map(b => ({
      colour: rgb(b.sum[0] / b.count, b.sum[1] / b.count, b.sum[2] / b.count),
      count: b.count,
    }))
    .sort((a, b) => b.count - a.count)

  const merged: { colour: Rgb; count: number }[] = []
  for (const candidate of ranked) {
    const near = merged.find(m => distance(m.colour, candidate.colour) < mergeBelow)
    if (near) {
      const total = near.count + candidate.count
      near.colour = mix(near.colour, candidate.colour, candidate.count / total)
      near.count = total
    } else if (merged.length < maxSwatches * 3) {
      merged.push({ colour: candidate.colour, count: candidate.count })
    }
  }

  return merged
    .sort((a, b) => b.count - a.count)
    .slice(0, maxSwatches)
    .map(m => ({ colour: m.colour, share: m.count / pixels.length }))
}

/**
 * The page background.
 *
 * Taken from the outer frame rather than the whole image: the middle of a
 * landing page is mostly content, and the most common colour overall can easily
 * be a hero panel rather than the page behind it.
 */
export function pageBackground(raster: Raster): Rgb {
  const band = Math.max(2, Math.round(Math.min(raster.width, raster.height) * 0.02))
  const edge: Rgb[] = []
  const step = Math.max(1, Math.round(raster.width / 400))

  for (let x = 0; x < raster.width; x += step) {
    for (let y = 0; y < band; y++) edge.push(at(raster, x, y))
    for (let y = raster.height - band; y < raster.height; y++) edge.push(at(raster, x, y))
  }
  for (let y = 0; y < raster.height; y += step) {
    for (let x = 0; x < band; x++) edge.push(at(raster, x, y))
    for (let x = raster.width - band; x < raster.width; x++) edge.push(at(raster, x, y))
  }

  const swatches = quantise(edge, 4)
  return swatches[0]?.colour ?? rgb(255, 255, 255)
}

export interface RegionColour {
  /** Mean colour of the ink pixels: the type colour. */
  foreground: Rgb
  /** Mean colour of everything else in the box: what the type sits on. */
  background: Rgb
  /** Ink pixels found. Zero means the split below is a guess. */
  inkPixels: number
}

/**
 * Split a region into its type colour and its backdrop.
 *
 * Deliberately does **not** use the ink mask. The mask is background
 * subtraction over a fixed radius, which finds an element's edges — and for
 * anything thicker than that radius, edges are *all* it finds. A ninety pixel
 * headline comes back as hollow outlines, and outline pixels are the antialiased
 * blend of the type and whatever is behind it. Reading the colour off them
 * turned a white headline on a green page into `#0e865c`: a colour that is on
 * the page nowhere, sitting exactly halfway between the two that are.
 *
 * So the colours come from the region's own histogram instead. The dominant
 * colour inside the box is the backdrop, because even tightly cropped type
 * leaves more background than letters, and the type is whichever colour sits
 * furthest from it while still covering a real share of the box.
 */
export function regionColour(raster: Raster, region: Box, minShare = 0.035): RegionColour {
  const area = clamp(region, raster)
  const pixels = samples(raster, area)
  if (pixels.length === 0) {
    return { foreground: rgb(0, 0, 0), background: rgb(255, 255, 255), inkPixels: 0 }
  }

  const swatches = quantise(pixels, 6, 9)
  const background = swatches[0]?.colour ?? rgb(255, 255, 255)

  const foreground = swatches
    .slice(1)
    .filter(s => s.share >= minShare)
    .sort((a, b) => distance(b.colour, background) - distance(a.colour, background))[0]?.colour

  return {
    foreground: foreground ?? furthestPixel(pixels, background),
    background,
    inkPixels: Math.round(pixels.length * (swatches.find(s => s.colour === foreground)?.share ?? 0)),
  }
}

/**
 * Fallback for a region whose type is too thin to form its own bucket: take the
 * single most extreme pixel present rather than inventing a colour.
 */
function furthestPixel(pixels: readonly Rgb[], from: Rgb): Rgb {
  let best = pixels[0] as Rgb
  let bestDistance = -1
  for (const pixel of pixels) {
    const d = distance(pixel, from)
    if (d > bestDistance) {
      bestDistance = d
      best = pixel
    }
  }
  return best
}

/**
 * A per-region mask of which pixels are type, by nearest colour.
 *
 * Exact where the global ink mask is approximate, and the basis for measuring
 * stroke weight: the global mask reports the width of a glyph's *outline* on
 * large type, which reads every display face as light.
 */
export function textMask(raster: Raster, region: Box, foreground: Rgb, background: Rgb): Mask {
  const area = clamp(region, raster)
  const mask: Mask = { width: area.w, height: area.h, data: new Uint8Array(area.w * area.h) }

  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < area.w; x++) {
      const pixel = at(raster, area.x + x, area.y + y)
      if (distance(pixel, foreground) < distance(pixel, background)) mask.data[y * area.w + x] = 1
    }
  }
  return mask
}

export interface Palette {
  background: Rgb
  /** Panels and cards sitting on the background. */
  surface: Rgb
  text: Rgb
  muted: Rgb
  accent: Rgb
  onAccent: Rgb
  border: Rgb
  dark: boolean
}

export interface PaletteInput {
  background: Rgb
  /** Type colours found on the page, most used first. */
  textColours: readonly Swatch[]
  /** Every colour on the page, for finding the accent. */
  overall: readonly Swatch[]
  /** Backdrops measured behind cards and buttons. */
  surfaces?: readonly Swatch[]
}

/**
 * Turn measurements into the seven colours a stylesheet needs.
 *
 * Nothing here is invented. The background is measured, the text colours are
 * measured, and the accent is chosen from colours that are actually present —
 * the only judgement is which measured colour plays which role.
 */
export function derivePalette(input: PaletteInput): Palette {
  const background = input.background
  const dark = isDark(background)

  const readable = input.textColours
    .filter(s => contrast(s.colour, background) >= 2.2)
    .sort((a, b) => b.share - a.share)

  const text = readable[0]?.colour ?? (dark ? rgb(255, 255, 255) : rgb(17, 17, 17))

  // Muted is the readable colour closest to halfway between text and
  // background, or a computed blend when the page has only one type colour.
  const muted = readable
    .slice(1)
    .filter(s => contrast(s.colour, background) < contrast(text, background))
    .sort((a, b) => contrast(b.colour, background) - contrast(a.colour, background))[0]?.colour
    ?? mix(text, background, 0.38)

  const accent = pickAccent(input.overall, background, text)

  const surface = input.surfaces?.[0]?.colour
    ?? mix(background, dark ? rgb(255, 255, 255) : rgb(0, 0, 0), 0.045)

  return {
    background,
    surface,
    text,
    muted,
    accent,
    onAccent: contrast(accent, rgb(255, 255, 255)) >= contrast(accent, rgb(17, 17, 17))
      ? rgb(255, 255, 255)
      : rgb(17, 17, 17),
    border: mix(background, dark ? rgb(255, 255, 255) : rgb(0, 0, 0), dark ? 0.14 : 0.11),
    dark,
  }
}

/**
 * The accent is the most saturated colour that is neither the background nor
 * the body text, weighted by how much of the page it covers.
 *
 * A page with no such colour genuinely has no accent, and gets a shifted text
 * colour rather than an invented hue.
 */
export function pickAccent(overall: readonly Swatch[], background: Rgb, text: Rgb): Rgb {
  const candidates = overall
    .filter(s => saturation(s.colour) > 0.22)
    .filter(s => distance(s.colour, background) > 20 && distance(s.colour, text) > 20)
    .filter(s => contrast(s.colour, background) > 1.35)
    .map(s => ({ ...s, weight: saturation(s.colour) * Math.sqrt(s.share) }))
    .sort((a, b) => b.weight - a.weight)

  const best = candidates[0]?.colour
  if (best) return best

  const bias = luminance(background) > 0.5 ? 0.55 : 0.35
  return mix(text, background, bias)
}
