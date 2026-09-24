import sharp from 'sharp'
import { type Rgb } from './colour.js'
import { type Box, clamp } from './geom.js'

/**
 * A decoded image: straight RGBA, four bytes per pixel, row major.
 *
 * Everything downstream works on this plain shape rather than on a sharp
 * instance, so the whole pipeline is testable by writing pixels into an array.
 */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const pixelIndex = (r: { width: number }, x: number, y: number): number => (y * r.width + x) * 4

export function at(r: Raster, x: number, y: number): Rgb {
  const i = pixelIndex(r, x, y)
  return { r: r.data[i] ?? 0, g: r.data[i + 1] ?? 0, b: r.data[i + 2] ?? 0 }
}

export function blank(width: number, height: number, fill: Rgb = { r: 255, g: 255, b: 255 }): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill.r
    data[i * 4 + 1] = fill.g
    data[i * 4 + 2] = fill.b
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

export function fillBox(r: Raster, b: Box, colour: Rgb): void {
  const region = clamp(b, r)
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const i = pixelIndex(r, x, y)
      r.data[i] = colour.r
      r.data[i + 1] = colour.g
      r.data[i + 2] = colour.b
      r.data[i + 3] = 255
    }
  }
}

/**
 * Decode a file to RGBA.
 *
 * Alpha is flattened onto white first. A PNG screenshot with a transparent
 * background otherwise reads as pure black in the raw buffer, which inverts
 * every light-or-dark decision made downstream.
 */
export async function load(file: string): Promise<Raster> {
  const { data, info } = await sharp(file)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  }
}

/** Rec. 709 luma, one byte per pixel. */
export function greyscale(r: Raster): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.width * r.height)
  for (let i = 0; i < out.length; i++) {
    const p = i * 4
    out[i] = 0.2126 * (r.data[p] ?? 0) + 0.7152 * (r.data[p + 1] ?? 0) + 0.0722 * (r.data[p + 2] ?? 0)
  }
  return out
}

/**
 * A box blur, run as two separable passes over a prefix sum.
 *
 * This is the local background estimate that lets the ink mask survive
 * gradients: subtracting a heavily blurred copy asks "does this pixel differ
 * from its own neighbourhood", not "is this pixel dark".
 */
export function blur(src: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius < 1) return src.slice()
  const horizontal = new Uint8ClampedArray(src.length)
  const window = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.max(0, Math.min(width - 1, x))] ?? 0
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / window
      const leaving = src[row + Math.max(0, Math.min(width - 1, x - radius))] ?? 0
      const entering = src[row + Math.max(0, Math.min(width - 1, x + radius + 1))] ?? 0
      sum += entering - leaving
    }
  }

  const out = new Uint8ClampedArray(src.length)
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x] ?? 0
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window
      const leaving = horizontal[Math.max(0, Math.min(height - 1, y - radius)) * width + x] ?? 0
      const entering = horizontal[Math.max(0, Math.min(height - 1, y + radius + 1)) * width + x] ?? 0
      sum += entering - leaving
    }
  }
  return out
}

/** A copy of one rectangle of the image, as its own raster. */
export function crop(r: Raster, region: Box): Raster {
  const area = clamp(region, r)
  const out: Raster = {
    width: area.w,
    height: area.h,
    data: new Uint8ClampedArray(area.w * area.h * 4),
  }
  for (let y = 0; y < area.h; y++) {
    const from = ((area.y + y) * r.width + area.x) * 4
    out.data.set(r.data.subarray(from, from + area.w * 4), y * area.w * 4)
  }
  return out
}

/** Every pixel inside a box, as a flat list. Used by the colour detectors. */
export function samples(r: Raster, b: Box, step = 1): Rgb[] {
  const region = clamp(b, r)
  const out: Rgb[] = []
  for (let y = region.y; y < region.y + region.h; y += step) {
    for (let x = region.x; x < region.x + region.w; x += step) {
      out.push(at(r, x, y))
    }
  }
  return out
}

/** A PNG of one region, upscaled — the buffer handed to OCR. */
export async function cropPng(file: string, region: Box, scale = 1): Promise<Buffer> {
  let pipeline = sharp(file)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
  if (scale > 1) {
    pipeline = pipeline.resize({
      width: Math.round(region.w * scale),
      height: Math.round(region.h * scale),
      kernel: 'lanczos3',
    })
  }
  return pipeline.png().toBuffer()
}

export async function dimensions(file: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(file).metadata()
  if (!meta.width || !meta.height) throw new Error(`could not read the dimensions of ${file}`)
  return { width: meta.width, height: meta.height }
}

export async function writePng(r: Raster, file: string): Promise<void> {
  await sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), {
    raw: { width: r.width, height: r.height, channels: 4 },
  })
    .png()
    .toFile(file)
}
