import sharp from 'sharp'
import { type Rgb, distance } from '../core/colour.js'

export interface Comparison {
  /** 0–1, where 1 is pixel-identical. */
  score: number
  /** Share of pixels whose colour is materially different. */
  differing: number
  /** Mean perceptual distance across the frame. */
  meanDelta: number
  width: number
  height: number
}

/**
 * How close a rebuild is to the image it was built from.
 *
 * The point of this is not a grade — it is a feedback loop. Nothing else in
 * this pipeline can tell you that a section is 40px too tall or that a colour
 * came out one step off, because every stage before it is measuring the input
 * and none of them ever look at the output. Rendering the result and comparing
 * it back to the original closes that loop, and it is the only check here that
 * can fail for a reason nobody anticipated.
 *
 * Compared in Lab, not RGB, and reported as both a share of changed pixels and
 * a mean distance: a page that is right everywhere except one wrong accent
 * scores very differently from one that is slightly off everywhere, and those
 * two failures want different fixes.
 */
export async function compare(
  aFile: string,
  bFile: string,
  options: { tolerance?: number } = {},
): Promise<Comparison> {
  const tolerance = options.tolerance ?? 8

  const meta = await sharp(aFile).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) throw new Error(`${aFile} has no dimensions`)

  const read = async (file: string): Promise<Buffer> => {
    const { data } = await sharp(file)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      // Both frames are forced onto the original's grid; a rebuild is never the
      // same height, and comparing different rasters is meaningless.
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return data
  }

  const [a, b] = await Promise.all([read(aFile), read(bFile)])

  let differing = 0
  let total = 0
  let sum = 0
  // Every pixel is overkill on a 1600x1000 frame and changes no digit of the
  // answer; a regular lattice is both faster and just as representative.
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 200_000)))

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 3
      const left: Rgb = { r: a[i] ?? 0, g: a[i + 1] ?? 0, b: a[i + 2] ?? 0 }
      const rightPixel: Rgb = { r: b[i] ?? 0, g: b[i + 1] ?? 0, b: b[i + 2] ?? 0 }
      const delta = distance(left, rightPixel)
      sum += delta
      total++
      if (delta > tolerance) differing++
    }
  }

  const share = total === 0 ? 1 : differing / total
  return {
    score: Math.max(0, 1 - share),
    differing: share,
    meanDelta: total === 0 ? 0 : sum / total,
    width,
    height,
  }
}

/**
 * A side-by-side with the differing pixels marked, written as a PNG.
 *
 * Reading a number tells you how wrong the rebuild is; looking at this tells
 * you *what* is wrong, which is the part that leads to a fix.
 */
export async function diffImage(
  aFile: string,
  bFile: string,
  outFile: string,
  options: { tolerance?: number } = {},
): Promise<string> {
  const tolerance = options.tolerance ?? 8
  const meta = await sharp(aFile).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0

  const read = async (file: string): Promise<Buffer> =>
    (
      await sharp(file)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    ).data

  const [a, b] = await Promise.all([read(aFile), read(bFile)])

  const marked = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const p = i * 3
    const left: Rgb = { r: a[p] ?? 0, g: a[p + 1] ?? 0, b: a[p + 2] ?? 0 }
    const rightPixel: Rgb = { r: b[p] ?? 0, g: b[p + 1] ?? 0, b: b[p + 2] ?? 0 }

    if (distance(left, rightPixel) > tolerance) {
      marked[p] = 255
      marked[p + 1] = 40
      marked[p + 2] = 90
    } else {
      // Keep the agreeing pixels, faded, so the marks have context.
      const grey = 255 - Math.round((255 - (left.r * 0.3 + left.g * 0.6 + left.b * 0.1)) * 0.25)
      marked[p] = grey
      marked[p + 1] = grey
      marked[p + 2] = grey
    }
  }

  const strip = async (file: string): Promise<Buffer> =>
    sharp(file).flatten({ background: { r: 255, g: 255, b: 255 } }).resize(width, height, { fit: 'fill' }).png().toBuffer()

  const panels = await Promise.all([
    strip(aFile),
    sharp(marked, { raw: { width, height, channels: 3 } }).png().toBuffer(),
    strip(bFile),
  ])

  await sharp({
    create: {
      width: width * 3 + 40,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      { input: panels[0], left: 0, top: 0 },
      { input: panels[1], left: width + 20, top: 0 },
      { input: panels[2], left: width * 2 + 40, top: 0 },
    ])
    .png()
    .toFile(outFile)

  return outFile
}
