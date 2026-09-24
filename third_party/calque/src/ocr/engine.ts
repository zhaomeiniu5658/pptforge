import { createWorker, PSM, type Worker } from 'tesseract.js'
import { type Box } from '../core/geom.js'
import { cropPng } from '../core/image.js'

export interface Reading {
  text: string
  /** 0–100, straight from the engine. */
  confidence: number
}

export interface ReadRegion extends Box {
  reading: Reading
  /** False when the pixels read as a picture rather than as type. */
  isText: boolean
  why: 'text' | 'low-confidence' | 'no-letters' | 'single-mark'
}

/**
 * Tesseract wants roughly thirty pixels of cap height. Interface type is
 * routinely twelve, and upscaling before recognition is worth several points
 * of confidence on every small label.
 */
export const scaleFor = (height: number, target = 34): number => {
  if (height <= 0) return 1
  return height >= target ? 1 : Math.min(6, Math.ceil((target / height) * 10) / 10)
}

const ALPHANUMERIC = /[\p{L}\p{N}]/u

export function tidy(text: string): string {
  return text
    // Escaped rather than literal. A control byte written straight into a
    // character class looks like whitespace in every editor, and one stray
    // copy-paste silently turns it into a range over real punctuation.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is this region type, or is it a picture?
 *
 * The answer falls out of the recognition itself. Running OCR over an icon
 * produces a confident-looking box with junk in it, and the engine's own
 * confidence is the cleanest separator available: on a real page the text runs
 * came back at 76–96 and every icon at 0–42, with nothing in between. That is
 * worth more than any heuristic on shape, and it costs nothing extra, because
 * the recognition had to run anyway.
 */
export function judge(reading: Reading, minConfidence = 55): ReadRegion['why'] {
  const text = reading.text
  if (!ALPHANUMERIC.test(text)) return 'no-letters'
  if (reading.confidence < minConfidence) return 'low-confidence'

  const letters = [...text].filter(ch => ALPHANUMERIC.test(ch)).length
  // One mark could be a letter or could be a glyph icon. Demand near certainty.
  if (letters <= 1 && reading.confidence < 82) return 'single-mark'
  return 'text'
}

export interface OcrOptions {
  language?: string
  minConfidence?: number
  /** Where tesseract keeps its trained data. */
  cachePath?: string
}

/**
 * A reusable recogniser.
 *
 * The worker is expensive to start and cheap to reuse, and every region on a
 * page goes through the same one.
 */
export class Recogniser {
  private worker: Worker | null = null
  private readonly options: Required<Omit<OcrOptions, 'cachePath'>> & { cachePath?: string }

  constructor(options: OcrOptions = {}) {
    this.options = {
      language: options.language ?? 'eng',
      minConfidence: options.minConfidence ?? 55,
      cachePath: options.cachePath,
    }
  }

  private async ready(): Promise<Worker> {
    if (this.worker) return this.worker
    const worker = await createWorker(
      this.options.language,
      undefined,
      this.options.cachePath ? { cachePath: this.options.cachePath } : undefined,
    )
    // Every crop handed over is one line by construction, so the engine is
    // told not to go looking for a page structure that is not there.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
    this.worker = worker
    return worker
  }

  /**
   * `origin` shifts region coordinates back into the coordinates of the file on
   * disk. Detection runs on a frame-trimmed copy of the image, but the crop for
   * recognition is taken from the original file, so the two have to be
   * reconciled here or every crop lands slightly off the text.
   */
  async readRegion(
    file: string,
    region: Box,
    page: { width: number; height: number },
    origin: { x: number; y: number } = { x: 0, y: 0 },
  ): Promise<ReadRegion> {
    const worker = await this.ready()
    const padding = Math.max(4, Math.round(region.h * 0.25))
    const crop = {
      x: Math.max(0, region.x + origin.x - padding),
      y: Math.max(0, region.y + origin.y - padding),
      w: 0,
      h: 0,
    }
    crop.w = Math.min(page.width - crop.x, region.w + padding * 2)
    crop.h = Math.min(page.height - crop.y, region.h + padding * 2)

    const png = await cropPng(file, crop, scaleFor(region.h))
    const { data } = await worker.recognize(png)
    const reading: Reading = { text: tidy(data.text), confidence: data.confidence }
    const why = judge(reading, this.options.minConfidence)
    return { ...region, reading, isText: why === 'text', why }
  }

  async readAll(
    file: string,
    regions: readonly Box[],
    page: { width: number; height: number },
    onProgress?: (done: number, total: number) => void,
    origin: { x: number; y: number } = { x: 0, y: 0 },
  ): Promise<ReadRegion[]> {
    const out: ReadRegion[] = []
    for (const region of regions) {
      out.push(await this.readRegion(file, region, page, origin))
      onProgress?.(out.length, regions.length)
    }
    return out
  }

  async close(): Promise<void> {
    await this.worker?.terminate()
    this.worker = null
  }
}
