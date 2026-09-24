import { type Rgb, distance, hex, mix, rgb } from '../core/colour.js'
import { area, type Box, bottom, centreX, overlapRatio, right, union, unionAll } from '../core/geom.js'
import { crop, load, type Raster, samples } from '../core/image.js'
import { inkMask, type Mask } from '../core/mask.js'
import {
  type Alignment,
  alignmentOf,
  bands,
  columns as columnsOf,
  contentBox,
  rowBackgrounds,
  spacingUnit,
  verticalGaps,
} from '../detect/layout.js'
import { detectFrame, hasFrame } from '../detect/frame.js'
import { coversBand, meanColour, photoRegions, type PhotoRegion } from '../detect/photos.js'
import { derivePalette, type Palette, quantise, regionColour, type Swatch, textMask } from '../detect/palette.js'
import { INK_OVERSHOOT, type Region, segment } from '../detect/regions.js'
import { looksLikeButton, type Surface, surfaceUnder } from '../detect/surfaces.js'
import {
  bodySize,
  buildScale,
  estimateFontSize,
  estimateWeight,
  roleForSize,
  strokeWidth,
  tidySize,
  typographicBox,
  type TextRole,
  type Weight,
} from '../detect/typography.js'
import { type ReadRegion, Recogniser } from '../ocr/engine.js'
import {
  type Block,
  type Column,
  type Note,
  type Section,
  type SectionKind,
  type Spec,
  SPEC_VERSION,
  type SurfaceStyle,
  type TextBlock,
} from './types.js'

export interface ExtractOptions {
  language?: string
  minConfidence?: number
  cachePath?: string
  /** Ink detection, exposed so the accuracy sweep can drive it. */
  inkThreshold?: number
  inkRadius?: number
  overshoot?: number
  tighten?: boolean
  /** Write detected photographs here as PNG crops and reference them. */
  assets?: { directory: string; prefix?: string }
  onProgress?: (stage: string, done?: number, total?: number) => void
}

/**
 * What an icon has to measure to be one.
 *
 * Both bounds matter, and the second is the one that earns its place: a
 * button's outline arrives as four separate strips, because the antialiased
 * curve at each rounded corner falls below the ink threshold and breaks the
 * ring apart. Those strips are 140x6 and 4x36 — long enough to pass any single
 * size test, and obviously not icons. Requiring a minimum on the *short* side
 * removes all four, and the hairline rules and underlines with them.
 */
export const MIN_ICON_SHORT_SIDE = 7
export const MIN_ICON_LONG_SIDE = 12

export const looksLikeIcon = (region: { w: number; h: number }): boolean =>
  Math.min(region.w, region.h) >= MIN_ICON_SHORT_SIDE && Math.max(region.w, region.h) >= MIN_ICON_LONG_SIDE

/**
 * Chosen by sweeping both against a fixture whose real values are known, not by
 * eye. A small radius keeps the rim narrow; a high threshold keeps it narrower
 * still. Together they took mean font-size error from 85% to 13%.
 */
export const DEFAULT_INK_RADIUS = 3
export const DEFAULT_INK_THRESHOLD = 90

/** A measured text run, before it becomes a block. */
interface Measured {
  region: Region
  read: ReadRegion
  fontSize: number
  weight: Weight
  colour: Rgb
  behind: Rgb
}

export async function extract(file: string, options: ExtractOptions = {}): Promise<Spec> {
  const started = Date.now()
  const progress = options.onProgress ?? (() => {})

  progress('decoding')
  const original = await load(file)
  const filePage = { width: original.width, height: original.height }

  // Everything downstream works on the page, not on the window it was captured
  // in. Coordinates in the spec are relative to the trimmed page.
  const frame = detectFrame(original)
  const raster = hasFrame(frame) ? crop(original, frame.content) : original
  const page = { width: raster.width, height: raster.height }
  const origin = { x: frame.content.x, y: frame.content.y }

  progress('finding ink')
  const inkRadius = options.inkRadius ?? DEFAULT_INK_RADIUS
  const ink = inkMask(raster, { threshold: options.inkThreshold ?? DEFAULT_INK_THRESHOLD, radius: inkRadius })

  progress('finding pictures')
  const photos = photoRegions(raster)

  progress('segmenting')
  const { lines, graphics, containers } = segment(ink, {
    overshoot: options.overshoot ?? INK_OVERSHOOT,
  })

  progress('reading', 0, lines.length)
  const recogniser = new Recogniser({
    language: options.language,
    minConfidence: options.minConfidence,
    cachePath: options.cachePath,
  })
  let readings: ReadRegion[]
  try {
    readings = await recogniser.readAll(
      file,
      lines,
      filePage,
      (done, total) => progress('reading', done, total),
      origin,
    )
  } finally {
    await recogniser.close()
  }

  progress('measuring')
  const measured: Measured[] = []
  const icons: Region[] = []
  let dropped = 0

  for (let i = 0; i < readings.length; i++) {
    const read = readings[i]
    const region = lines[i]
    if (!read || !region) continue

    if (!read.isText) {
      // A speck is not an icon. Below this it is compression noise, the tail of
      // an antialiased curve, or the dot left over from a glyph that failed to
      // group — and drawing a placeholder for it puts marks on the rebuild that
      // are on no design anywhere.
      if (looksLikeIcon(region)) icons.push(region)
      else dropped++
      continue
    }

    // Two characters read at middling confidence is far more often a fragment
    // than a word. "mm" under a headline was a piece of the headline.
    if (read.reading.text.replace(/[^\p{L}\p{N}]/gu, '').length <= 2 && read.reading.confidence < 90) {
      dropped++
      continue
    }

    const colours = regionColour(raster, region)
    // Everything geometric is measured on the tightened box, not the ink blob.
    const tight = options.tighten === true
      ? typographicBox(raster, region, colours.foreground, colours.background)
      : region
    const fontSize = estimateFontSize(tight.h, read.reading.text)
    const glyphMask = textMask(raster, tight, colours.foreground, colours.background)
    const stroke = strokeWidth(glyphMask, { x: 0, y: 0, w: glyphMask.width, h: glyphMask.height })
    measured.push({
      region: { ...region, ...tight },
      read,
      fontSize,
      weight: estimateWeight(stroke, fontSize),
      colour: colours.foreground,
      behind: colours.background,
    })
  }

  const background = pageBackgroundOf(raster)
  const palette = derivePalette({
    background,
    textColours: swatchesOf(measured.map(m => m.colour)),
    overall: quantise(
      samples(raster, { x: 0, y: 0, w: page.width, h: page.height }, Math.max(1, Math.round(raster.width / 260))),
      12,
    ),
    surfaces: swatchesOf(measured.map(m => m.behind).filter(c => distance(c, background) > 7)),
  })

  progress('laying out')
  const elements: Box[] = [...lines, ...graphics]
  const content = contentBox(elements, page)
  const scaleSizes = measured.map(m => m.fontSize)
  const scale = buildScale(scaleSizes)
  const body = bodySize(scale)

  const backgroundsByRow = rowBackgrounds(raster)
  const sliced = mergePhotoBands(bands(ink, raster, elements), photos)
  const notes: Note[] = []
  const sections: Section[] = []

  for (let i = 0; i < sliced.length; i++) {
    const band = sliced[i]
    if (!band) continue
    const section = buildSection({
      band,
      index: i,
      total: sliced.length,
      measured,
      icons,
      graphics,
      raster,
      ink,
      palette,
      body,
      content,
      page,
      photos,
      backgroundsByRow,
    })
    if (section) sections.push(section)
  }

  if (sections.length === 0) {
    notes.push({ severity: 'warn', message: 'No sections were found. The image may not be a page screenshot.' })
  }

  const lowConfidence = measured.filter(m => m.read.reading.confidence < 70)
  if (lowConfidence.length > 0) {
    notes.push({
      severity: 'warn',
      message:
        `${lowConfidence.length} of ${measured.length} text runs read below 70% confidence. ` +
        `Check these strings before trusting them.`,
    })
  }
  if (icons.length > 0) {
    notes.push({
      severity: 'info',
      message: `${icons.length} regions read as graphics rather than type and became icon placeholders.`,
    })
  }
  if (photos.length > 0) {
    const biggest = photos[0]
    notes.push({
      severity: 'info',
      message:
        `${photos.length} photographic regions were found, the largest covering ` +
        `${Math.round((biggest?.coverage ?? 0) * 100)}% of the page. ` +
        `A screenshot holds these only at the size they were displayed; run with --assets to keep them.`,
    })
  }
  if (graphics.length > 0) {
    notes.push({
      severity: 'info',
      message: `${graphics.length} image regions were measured but their contents cannot be recovered from a screenshot.`,
    })
  }
  if (dropped > 0) {
    notes.push({
      severity: 'info',
      message: `${dropped} marks were too small or too doubtful to be anything and were left out.`,
    })
  }
  notes.push({
    severity: 'info',
    message:
      'The type face is a metric-compatible stack, not an identification. ' +
      'A typeface cannot be told from a screenshot with any honesty.',
  })

  const gaps = verticalGaps(measured.map(m => m.region))
  const radii = collectRadii(sections)

  return {
    calque: SPEC_VERSION,
    source: {
      file,
      width: raster.width,
      height: raster.height,
      trimmed: origin,
      tookMs: Date.now() - started,
    },
    tokens: {
      colour: {
        background: hex(palette.background),
        surface: hex(palette.surface),
        text: hex(palette.text),
        muted: hex(palette.muted),
        accent: hex(palette.accent),
        onAccent: hex(palette.onAccent),
        border: hex(palette.border),
        dark: palette.dark,
      },
      type: {
        body: tidySize(body),
        family: familyFor(measured, body),
        scale: scaleSteps(scale, body, measured),
      },
      space: {
        unit: spacingUnit(gaps),
        container: content.w,
        gutter: content.x,
      },
      radius: {
        small: radii.small,
        medium: radii.medium,
        large: radii.large,
        square: radii.square,
      },
    },
    sections,
    notes,
  }
}

/**
 * Join neighbouring bands that are lying on the same photograph.
 *
 * A photograph is not a stack of sections, but every stage before this one
 * measures it as if it were: the ink profile inside a picture is noisy rather
 * than empty, so gaps appear wherever the image happens to be smooth, and the
 * background colour drifts continuously so colour boundaries fire too. A
 * full-bleed hero came apart into nine sections stacked down the page, none of
 * them the shape of anything on the original.
 *
 * A picture is one thing. Bands that sit on one belong together.
 */
export function mergePhotoBands<T extends { x: number; y: number; w: number; h: number }>(
  input: readonly T[],
  photos: readonly Box[],
): T[] {
  if (photos.length === 0) return [...input]

  const out: T[] = []
  for (const band of input) {
    const previous = out[out.length - 1]
    const onPhoto = coversBand(photos, band)

    if (previous && onPhoto && coversBand(photos, previous)) {
      out[out.length - 1] = { ...previous, h: band.y + band.h - previous.y }
      continue
    }
    out.push({ ...band })
  }
  return out
}

// ── Sections ────────────────────────────────────────────────────────────────

interface SectionInput {
  band: { x: number; y: number; w: number; h: number; background: Rgb }
  index: number
  total: number
  measured: readonly Measured[]
  icons: readonly Region[]
  graphics: readonly Region[]
  raster: Raster
  ink: Mask
  palette: Palette
  body: number
  content: Box
  page: { width: number; height: number }
  photos: readonly PhotoRegion[]
  backgroundsByRow: readonly Rgb[]
}

function buildSection(input: SectionInput): Section | null {
  const { band, measured, icons, graphics, raster, ink, palette, body, page } = input

  // Assign by centre, not by edge: an element straddling a boundary belongs to
  // whichever section most of it is in.
  const withinBand = (b: Box): boolean => {
    const middle = b.y + b.h / 2
    return middle >= band.y && middle < band.y + band.h
  }

  const texts = measured.filter(m => withinBand(m.region))
  const bandIcons = icons.filter(withinBand)
  const bandGraphics = graphics.filter(withinBand)
  if (texts.length === 0 && bandIcons.length === 0 && bandGraphics.length === 0) return null

  const everything: Box[] = [
    ...texts.map(t => t.region),
    ...bandIcons,
    ...bandGraphics,
  ]
  const extent = everything.reduce((acc, b) => union(acc, b))

  const found = columnsOf(ink, band)
  const columnBoxes = found.length > 0 ? found : [extent]

  const columns: Column[] = []
  for (const columnBox of columnBoxes) {
    const column = buildColumn({
      columnBox,
      texts: texts.filter(t => centreX(t.region) >= columnBox.x && centreX(t.region) < right(columnBox)),
      icons: bandIcons.filter(i => centreX(i) >= columnBox.x && centreX(i) < right(columnBox)),
      graphics: bandGraphics.filter(g => centreX(g) >= columnBox.x && centreX(g) < right(columnBox)),
      raster,
      ink,
      palette,
      background: band.background,
      body,
      page,
    })
    if (column) columns.push(column)
  }
  if (columns.length === 0) return null

  const total = columns.reduce((sum, c) => sum + c.box.w, 0) || 1
  for (const column of columns) column.fraction = Math.round((column.box.w / total) * 1000) / 1000

  const gap = columns.length > 1
    ? Math.round(
        columns.slice(1).reduce((sum, c, i) => sum + (c.box.x - right((columns[i] as Column).box)), 0) /
          (columns.length - 1),
      )
    : 0

  const kind = classify({ ...input, texts, columns, extent })

  const bandBox: Box = { x: band.x, y: band.y, w: band.w, h: band.h }
  const backdrop = coversBand(input.photos, bandBox)
    ? { colour: hex(meanColour(raster, bandBox)), src: null as string | null, box: bandBox }
    : null

  return {
    id: `${kind.kind}-${input.index + 1}`,
    kind: kind.kind,
    box: { x: band.x, y: band.y, w: band.w, h: band.h },
    background: hex(band.background),
    gradient: backdrop ? null : measureGradient(input.backgroundsByRow, bandBox),
    backdrop,
    padding: capPadding(
      Math.max(0, extent.y - band.y),
      Math.max(0, band.y + band.h - bottom(extent)),
      input.page.height,
    ),
    align: alignmentOf(columns.map(c => c.box), { x: band.x, y: band.y, w: band.w, h: band.h }),
    gap: Math.max(0, gap),
    layout: rowLayout(columns),
    columns,
    confidence: kind.confidence,
  }
}

/**
 * Whether a row of columns is an even grid or is pushed apart.
 *
 * A three-up feature grid and a nav bar are both "several columns in a row",
 * and rendering them the same way gets one of them wrong. The distinction is
 * visible in the gaps: a grid has even ones, and a nav has a single large gap
 * between the brand and the links. Rebuilt as an even grid, a nav spreads its
 * brand and links evenly across the page, which no nav has ever done.
 */
/**
 * Keep a section's padding to something a person would have typed.
 *
 * The empty space below the last element of a screenshot is not a design
 * decision, it is where the person stopped scrolling. Carried through
 * literally it became 362px of padding under this fixture's footer, so the
 * rebuild ended in a third of a page of nothing.
 */
export function capPadding(top: number, bottom: number, pageHeight: number): { top: number; bottom: number } {
  const ceiling = Math.max(48, Math.round(pageHeight * 0.14))
  return {
    top: Math.min(Math.round(top), ceiling),
    bottom: Math.min(Math.round(bottom), ceiling),
  }
}

export function rowLayout(columns: readonly Column[]): 'stack' | 'grid' | 'between' {
  if (columns.length <= 1) return 'stack'

  const gaps: number[] = []
  for (let i = 1; i < columns.length; i++) {
    gaps.push((columns[i] as Column).box.x - right((columns[i - 1] as Column).box))
  }
  const widest = Math.max(...gaps)
  const narrowest = Math.min(...gaps)
  const widths = columns.map(c => c.box.w)
  const evenWidths = Math.max(...widths) / Math.max(1, Math.min(...widths)) < 1.6

  // One gap much larger than the rest is a deliberate separation, not a grid.
  if (widest > Math.max(narrowest, 1) * 2.5) return 'between'
  return evenWidths ? 'grid' : 'between'
}

interface ColumnInput {
  columnBox: Box
  texts: readonly Measured[]
  icons: readonly Region[]
  graphics: readonly Region[]
  raster: Raster
  ink: Mask
  palette: Palette
  background: Rgb
  body: number
  page: { width: number; height: number }
}

function buildColumn(input: ColumnInput): Column | null {
  const { texts, icons, graphics, raster, palette, background, body, page } = input
  if (texts.length === 0 && icons.length === 0 && graphics.length === 0) return null

  const paragraphs = mergeParagraphs(texts)
  const blocks: Block[] = []
  const surfaces: { surface: Surface; covers: Box[] }[] = []

  for (const paragraph of paragraphs) {
    const surface = surfaceUnder(raster, paragraph.box, paragraph.behind, background)
    const role = roleForSize(paragraph.fontSize, body)

    if (surface && looksLikeButton(surface, paragraph.box, page) && paragraph.lines === 1) {
      blocks.push({
        type: 'button',
        box: surface,
        label: paragraph.text,
        variant: variantOf(surface, background, palette),
        fill: hex(surface.fill),
        colour: hex(paragraph.colour),
        radius: surface.radius,
        size: tidySize(paragraph.fontSize),
        weight: paragraph.weight,
        confidence: Math.round(paragraph.confidence),
      })
      continue
    }

    if (surface) {
      // Matched by overlap rather than by equal coordinates. Two runs on the
      // same card are seeded from different points, so the rectangles they grow
      // agree on what they found while differing by a pixel or two on where it
      // starts — and an exact-match test then reports one card per line of text
      // and promotes none of them.
      const existing = surfaces.find(s => overlapRatio(s.surface, surface) > 0.6)
      if (existing) existing.covers.push(paragraph.box)
      else surfaces.push({ surface, covers: [paragraph.box] })
    }

    blocks.push({
      type: 'text',
      box: paragraph.box,
      role,
      text: paragraph.text,
      size: tidySize(paragraph.fontSize),
      weight: paragraph.weight,
      colour: hex(paragraph.colour),
      align: paragraph.align,
      confidence: Math.round(paragraph.confidence),
    } satisfies TextBlock)
  }

  for (const icon of icons) {
    const colours = regionColour(raster, icon)
    blocks.push({
      type: 'icon',
      box: icon,
      colour: hex(colours.foreground),
      size: Math.max(icon.w, icon.h),
    })
  }

  for (const graphic of graphics) {
    const pixels = samples(raster, graphic, Math.max(1, Math.round(graphic.w / 40)))
    blocks.push({
      type: 'image',
      box: graphic,
      aspect: Math.round((graphic.w / Math.max(1, graphic.h)) * 100) / 100,
      averageColour: hex(quantise(pixels, 1)[0]?.colour ?? rgb(200, 200, 200)),
      radius: 0,
    })
  }

  blocks.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)

  /**
   * A panel meaningfully larger than the text that found it is a card, and the
   * column's blocks sit inside it.
   *
   * Sized against its contents rather than counted: a card with one line of
   * text on it is still a card, and requiring two lines missed every one of
   * them on a three-up feature grid whose cards hold a title and a sentence
   * that merge into a single paragraph.
   */
  const card = surfaces
    .filter(s => {
      const covered = unionAll(s.covers)
      return covered !== null && area(s.surface) > area(covered) * 1.15
    })
    .sort((a, b) => area(b.surface) - area(a.surface))[0]?.surface ?? null
  const box = blocks.map(b => b.box).reduce((acc, b) => union(acc, b))
  const gaps = verticalGaps(blocks.map(b => b.box))

  const style: SurfaceStyle | null = card
    ? {
        fill: hex(card.fill),
        radius: card.radius,
        border: card.border ? { colour: hex(card.border.colour), width: card.border.width } : null,
        // The smallest of the four insets between the panel and what is on it.
        // Taking only two of them, as this did, produced a padding of zero and
        // cards whose text sat flush against the corner.
        padding: Math.max(
          0,
          Math.round(
            Math.min(
              box.x - card.x,
              right(card) - right(box),
              box.y - card.y,
              bottom(card) - bottom(box),
            ),
          ),
        ),
      }
    : null

  return {
    box: card ?? box,
    fraction: 1,
    align: alignmentOf(blocks.map(b => b.box), card ?? input.columnBox),
    gap: gaps.length > 0 ? Math.round(median(gaps)) : 0,
    surface: style,
    blocks,
  }
}

function variantOf(surface: Surface, background: Rgb, palette: Palette): 'solid' | 'outline' | 'ghost' {
  if (distance(surface.fill, background) < 6) return surface.border ? 'outline' : 'ghost'
  if (distance(surface.fill, palette.accent) < 24) return 'solid'
  return 'solid'
}

/**
 * A vertical gradient across a section, or null if the background is flat.
 *
 * Worth measuring rather than averaging away. A gradient is not a picture — it
 * is two colours and a direction, all three of which a stylesheet can say
 * exactly — but flattened to its mean it becomes a slab of muddy colour, and on
 * a page whose whole identity is a green glow behind the headline that is most
 * of what the design was.
 *
 * Only the vertical case is handled. A radial or diagonal gradient measures as
 * the vertical component of itself, which is closer than one flat colour and
 * plainly not the same thing.
 */
export function measureGradient(
  backgrounds: readonly Rgb[],
  band: Box,
  minDelta = 6,
): { from: string; to: string } | null {
  const sample = (from: number, to: number): Rgb | null => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = Math.max(0, from); y < Math.min(backgrounds.length, to); y++) {
      const c = backgrounds[y]
      if (!c) continue
      r += c.r
      g += c.g
      b += c.b
      n++
    }
    return n === 0 ? null : { r: r / n, g: g / n, b: b / n }
  }

  const window = Math.max(2, Math.round(band.h * 0.12))
  const top = sample(band.y, band.y + window)
  const base = sample(bottom(band) - window, bottom(band))
  if (!top || !base) return null
  if (distance(top, base) < minDelta) return null

  return { from: hex(top), to: hex(base) }
}

// ── Paragraphs ──────────────────────────────────────────────────────────────

interface Paragraph {
  box: Box
  text: string
  fontSize: number
  weight: Weight
  colour: Rgb
  behind: Rgb
  align: Alignment
  confidence: number
  lines: number
  lineHeight: number
}

/**
 * Rejoin the lines of a wrapped paragraph.
 *
 * Segmentation finds lines, but a paragraph that wrapped over three of them is
 * one element with one font size, not three. Consecutive runs at the same size,
 * stacked tightly and aligned to each other, are the same paragraph — and the
 * distance between their tops is the line height, which is otherwise
 * unmeasurable.
 */
export function mergeParagraphs(items: readonly Measured[]): Paragraph[] {
  const sorted = [...items].sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x)
  const out: Paragraph[] = []
  let run: Measured[] = []

  const flush = (): void => {
    if (run.length === 0) return
    const boxes: Box[] = run.map(m => ({ x: m.region.x, y: m.region.y, w: m.region.w, h: m.region.h }))
    const box = unionAll(boxes) as Box
    const first = run[0] as Measured

    const tops = boxes.map(b => b.y)
    const steps: number[] = []
    for (let i = 1; i < tops.length; i++) steps.push((tops[i] as number) - (tops[i - 1] as number))

    out.push({
      box,
      text: run.map(m => m.read.reading.text).join(' ').replace(/\s+/g, ' ').trim(),
      fontSize: run.reduce((sum, m) => sum + m.fontSize, 0) / run.length,
      weight: first.weight,
      colour: first.colour,
      behind: first.behind,
      align: alignmentOf(boxes, box),
      confidence: run.reduce((sum, m) => sum + m.read.reading.confidence, 0) / run.length,
      lines: run.length,
      lineHeight: steps.length > 0 ? median(steps) / Math.max(1, first.fontSize) : 1.4,
    })
    run = []
  }

  for (const item of sorted) {
    const previous = run[run.length - 1]
    if (!previous) {
      run = [item]
      continue
    }

    const sameSize = Math.abs(item.fontSize - previous.fontSize) <= previous.fontSize * 0.14
    const step = item.region.y - previous.region.y
    // Lines of one paragraph sit between one and two font sizes apart.
    const stacked = step > 0 && step < previous.fontSize * 2.1
    const sameColumn =
      Math.abs(item.region.x - previous.region.x) < previous.fontSize * 1.5 ||
      Math.abs(centreX(item.region) - centreX(previous.region)) < previous.fontSize * 1.5
    const sameColour = distance(item.colour, previous.colour) < 14

    if (sameSize && stacked && sameColumn && sameColour) run.push(item)
    else {
      flush()
      run = [item]
    }
  }
  flush()
  return out
}

// ── Classification ──────────────────────────────────────────────────────────

interface ClassifyInput {
  index: number
  total: number
  texts: readonly Measured[]
  columns: readonly Column[]
  extent: Box
  body: number
  page: { width: number; height: number }
  band: { y: number; h: number }
}

/**
 * Name each section from its shape.
 *
 * Deterministic on purpose. A language model is not needed to notice that the
 * first strip on the page is short, wide and full of small links, and a rule
 * that can be read is worth more than a call that has to be trusted. The
 * returned confidence says how firmly the shape matched, and a model — or a
 * person — can overrule it afterwards.
 */
export function classify(input: ClassifyInput): { kind: SectionKind; confidence: number } {
  const { index, total, texts, columns, page, band, body } = input
  const first = index === 0
  const last = index === total - 1
  const shortStrip = band.h < page.height * 0.14
  const sizes = texts.map(t => t.fontSize)
  const largest = sizes.length > 0 ? Math.max(...sizes) : 0
  const smallText = sizes.length > 0 && sizes.every(s => s <= body * 1.2)

  if (first && shortStrip && smallText && texts.length >= 2) {
    return { kind: 'nav', confidence: 0.9 }
  }
  if (last && smallText && texts.length >= 2) {
    return { kind: 'footer', confidence: shortStrip ? 0.85 : 0.6 }
  }
  if (largest >= body * 2.4) {
    return { kind: 'hero', confidence: index <= 1 ? 0.9 : 0.65 }
  }
  if (columns.length >= 3) {
    const images = columns.filter(c => c.blocks.some(b => b.type === 'image')).length
    return images > columns.length / 2
      ? { kind: 'gallery', confidence: 0.7 }
      : { kind: 'features', confidence: 0.8 }
  }
  if (columns.some(c => c.blocks.some(b => b.type === 'button')) && texts.length <= 4) {
    return { kind: 'cta', confidence: 0.65 }
  }
  return { kind: 'content', confidence: 0.5 }
}

// ── Tokens ──────────────────────────────────────────────────────────────────

function pageBackgroundOf(raster: Raster): Rgb {
  const edge = Math.max(2, Math.round(Math.min(raster.width, raster.height) * 0.02))
  const pixels: Rgb[] = [
    ...samples(raster, { x: 0, y: 0, w: raster.width, h: edge }, 3),
    ...samples(raster, { x: 0, y: raster.height - edge, w: raster.width, h: edge }, 3),
    ...samples(raster, { x: 0, y: 0, w: edge, h: raster.height }, 3),
    ...samples(raster, { x: raster.width - edge, y: 0, w: edge, h: raster.height }, 3),
  ]
  return quantise(pixels, 3)[0]?.colour ?? rgb(255, 255, 255)
}

function swatchesOf(colours: readonly Rgb[]): Swatch[] {
  return quantise(colours, 8, 10)
}

function scaleSteps(
  scale: readonly { size: number; count: number }[],
  body: number,
  measured: readonly Measured[],
): Spec['tokens']['type']['scale'] {
  const roles = new Map<TextRole, { size: number; weight: Weight; lineHeight: number }>()

  for (const step of scale) {
    const role = roleForSize(step.size, body)
    if (roles.has(role)) continue
    const nearby = measured.filter(m => Math.abs(m.fontSize - step.size) <= step.size * 0.1)
    const weights = nearby.map(m => m.weight).sort((a, b) => a - b)
    roles.set(role, {
      size: tidySize(step.size),
      weight: (weights[Math.floor(weights.length / 2)] ?? 400) as Weight,
      // Display type is set tighter than body type, always.
      lineHeight: step.size > body * 2 ? 1.1 : step.size > body * 1.3 ? 1.25 : 1.5,
    })
  }

  const order: TextRole[] = ['display', 'heading', 'subheading', 'body', 'label', 'caption']
  return order
    .filter(role => roles.has(role))
    .map(role => ({ role, ...(roles.get(role) as { size: number; weight: Weight; lineHeight: number }) }))
}

/**
 * Choose a font stack by measured character advance.
 *
 * Not an identification — advance is the one metric a screenshot actually
 * reveals, and it is enough to tell a monospaced face from a proportional one.
 */
export function familyFor(measured: readonly Measured[], body: number): string {
  const usable = measured.filter(m => m.read.reading.text.length >= 6 && m.fontSize > body * 0.7)
  if (usable.length === 0) return SANS

  const advances = usable.map(m => m.region.w / m.read.reading.text.length / m.fontSize)
  const typical = median(advances)
  return typical > 0.57 ? MONO : SANS
}

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

function collectRadii(sections: readonly Section[]): Spec['tokens']['radius'] {
  const found: number[] = []
  for (const section of sections) {
    for (const column of section.columns) {
      if (column.surface) found.push(column.surface.radius)
      for (const block of column.blocks) {
        if (block.type === 'button') found.push(block.radius)
        if (block.type === 'image') found.push(block.radius)
      }
    }
  }

  const rounded = found.filter(r => r > 0).sort((a, b) => a - b)
  if (rounded.length === 0) return { small: 0, medium: 0, large: 0, square: true }

  const pick = (fraction: number): number =>
    Math.round(rounded[Math.min(rounded.length - 1, Math.floor(rounded.length * fraction))] ?? 0)

  return { small: pick(0.15), medium: pick(0.5), large: pick(0.9), square: false }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export { mix }
