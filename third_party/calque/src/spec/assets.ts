import { mkdir } from 'node:fs/promises'
import { basename, join, relative, dirname } from 'node:path'
import sharp from 'sharp'
import { type Box } from '../core/geom.js'
import { type Spec } from './types.js'

export interface AssetOptions {
  /** Where the PNG crops go. */
  directory: string
  /** What the HTML file's `src` values are relative to. */
  relativeTo?: string
  /** Offset from spec coordinates back to the file on disk, for a trimmed frame. */
  origin?: { x: number; y: number }
  prefix?: string
}

/**
 * Cut the detected photographs out of the screenshot and write them as PNGs.
 *
 * This is the difference between a rebuild of a photographic page being usable
 * and being a blank rectangle. The crops are not the original assets and the
 * README says so plainly — they are screenshot resolution, and any text that
 * was sitting on top of them is baked in — but they are the right picture at
 * the right size in the right place, which is most of the way there, and the
 * alternative is a grey box and a note apologising for it.
 */
export async function writeAssets(spec: Spec, file: string, options: AssetOptions): Promise<Spec> {
  const origin = options.origin ?? spec.source.trimmed ?? { x: 0, y: 0 }
  const prefix = options.prefix ?? basename(file).replace(/\.[^.]+$/, '')
  await mkdir(options.directory, { recursive: true })

  const relativeTo = options.relativeTo ?? dirname(options.directory)
  let index = 0

  const cut = async (box: Box, name: string): Promise<string | null> => {
    const region = {
      left: Math.max(0, Math.round(box.x + origin.x)),
      top: Math.max(0, Math.round(box.y + origin.y)),
      width: Math.max(1, Math.round(box.w)),
      height: Math.max(1, Math.round(box.h)),
    }
    const out = join(options.directory, `${prefix}-${name}.png`)
    try {
      await sharp(file).extract(region).png().toFile(out)
    } catch {
      return null
    }
    const link = relative(relativeTo, out)
    // A stylesheet needs forward slashes whatever the platform uses on disk.
    return link.split(/[\\/]/).join('/')
  }

  for (const section of spec.sections) {
    if (section.backdrop) {
      section.backdrop.src = await cut(section.backdrop.box, `${section.id}-backdrop`)
    }
    for (const column of section.columns) {
      for (const block of column.blocks) {
        if (block.type === 'image') {
          block.src = await cut(block.box, `image-${++index}`)
        }
      }
    }
  }

  return spec
}
