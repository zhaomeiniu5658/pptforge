import { type Box } from '../core/geom.js'
import { type Alignment } from '../detect/layout.js'
import { type TextRole, type Weight } from '../detect/typography.js'

export const SPEC_VERSION = '1' as const

/**
 * What calque extracted from an image.
 *
 * Two things live side by side here on purpose. Every element carries the
 * `box` it was measured at, in source pixels, which is ground truth and never
 * a guess; and the elements are arranged into sections and columns, which is
 * an inference and can be wrong. Anything reading this file — a renderer, a
 * language model, a person — can tell the two apart, and `confidence` and
 * `notes` say where the inference is thin.
 */
export interface Spec {
  calque: typeof SPEC_VERSION
  source: Source
  tokens: Tokens
  sections: Section[]
  /** Where the extraction was unsure. Shown to the user, not swept up. */
  notes: Note[]
}

export interface Source {
  file: string
  /** Dimensions of the page, after any window frame was trimmed. */
  width: number
  height: number
  /**
   * Where the page starts inside the original file.
   *
   * Every box in this spec is relative to the trimmed page, so anything that
   * goes back to the file on disk — cropping an asset out of it, re-reading a
   * region — has to add this back first.
   */
  trimmed?: { x: number; y: number }
  /** Wall-clock milliseconds the extraction took. */
  tookMs?: number
}

export interface Note {
  severity: 'info' | 'warn'
  message: string
  box?: Box
}

// ── Design tokens ───────────────────────────────────────────────────────────

export interface Tokens {
  colour: ColourTokens
  type: TypeTokens
  space: SpaceTokens
  radius: RadiusTokens
}

/** Every value is a hex string measured from the image. */
export interface ColourTokens {
  background: string
  surface: string
  text: string
  muted: string
  accent: string
  onAccent: string
  border: string
  /** True when the page is a dark theme. */
  dark: boolean
}

export interface TypeTokens {
  /** Body size in pixels. */
  body: number
  /**
   * A font stack, not an identification. Type faces cannot be told apart from a
   * screenshot with any honesty; this is a stack whose metrics are close to
   * what was measured.
   */
  family: string
  scale: TypeStep[]
}

export interface TypeStep {
  role: TextRole
  size: number
  weight: Weight
  lineHeight: number
}

export interface SpaceTokens {
  /** The rhythm the page is laid out on, usually 4 or 8. */
  unit: number
  /** Width of the content column in pixels. */
  container: number
  /** Space between the content and the page edge. */
  gutter: number
}

export interface RadiusTokens {
  small: number
  medium: number
  large: number
  /** True when nothing on the page had a rounded corner. */
  square: boolean
}

// ── Structure ───────────────────────────────────────────────────────────────

export type SectionKind =
  | 'nav'
  | 'hero'
  | 'features'
  | 'content'
  | 'gallery'
  | 'cta'
  | 'footer'

/**
 * A photograph behind a section.
 *
 * A screenshot cannot recover the original asset, but it does contain the
 * pixels as they were displayed. `src` is a crop taken straight from the
 * screenshot when assets were written; it is the right size and the right
 * picture, at screenshot resolution and with any text that was over it baked
 * in. `colour` is the honest fallback when no crop was written.
 */
export interface Backdrop {
  colour: string
  src: string | null
  box: Box
}

export interface Section {
  id: string
  kind: SectionKind
  /** Measured, in source pixels. */
  box: Box
  background: string
  /**
   * A vertical gradient measured across the section, when the background is
   * not one flat colour. `from` is the colour at the top edge, `to` at the
   * bottom.
   */
  gradient?: { from: string; to: string } | null
  /** A photograph covering this section, if there is one. */
  backdrop?: Backdrop | null
  /** Space above and below the content inside this section. */
  padding: { top: number; bottom: number }
  align: Alignment
  /** Space between columns. */
  gap: number
  /**
   * How the columns sit in the row.
   * `stack` one column; `grid` equal columns; `between` pushed to the edges,
   * which is what a nav with a brand on the left and links on the right is.
   */
  layout: 'stack' | 'grid' | 'between'
  columns: Column[]
  /** 0–1. How much the section kind is a guess. */
  confidence: number
}

export interface Column {
  box: Box
  /** Share of the row's width, 0–1. Equal shares become a grid. */
  fraction: number
  align: Alignment
  gap: number
  surface: SurfaceStyle | null
  blocks: Block[]
}

export interface SurfaceStyle {
  fill: string
  radius: number
  border: { colour: string; width: number } | null
  padding: number
}

export type Block = TextBlock | ButtonBlock | ImageBlock | IconBlock | DividerBlock

interface BlockBase {
  box: Box
}

export interface TextBlock extends BlockBase {
  type: 'text'
  role: TextRole
  text: string
  size: number
  weight: Weight
  colour: string
  align: Alignment
  /** OCR confidence, 0–100. Below about 70 the string is worth a second look. */
  confidence: number
}

export interface ButtonBlock extends BlockBase {
  type: 'button'
  label: string
  /** Filled buttons carry the accent; outline and ghost do not. */
  variant: 'solid' | 'outline' | 'ghost'
  fill: string
  colour: string
  radius: number
  size: number
  weight: Weight
  confidence: number
}

/**
 * A picture. The pixels are not recoverable as markup, so this records where it
 * was, what shape it was and what colour it averaged to, and the renderer draws
 * a placeholder of exactly those dimensions.
 */
export interface ImageBlock extends BlockBase {
  type: 'image'
  aspect: number
  averageColour: string
  radius: number
  /** A crop from the screenshot, when assets were written. */
  src?: string | null
}

/** A small glyph — read as a picture, sized like type. */
export interface IconBlock extends BlockBase {
  type: 'icon'
  colour: string
  size: number
}

export interface DividerBlock extends BlockBase {
  type: 'divider'
  colour: string
  thickness: number
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isTextBlock(block: Block): block is TextBlock {
  return block.type === 'text'
}

export function allBlocks(spec: Spec): Block[] {
  return spec.sections.flatMap(s => s.columns.flatMap(c => c.blocks))
}

export function textOf(spec: Spec): string[] {
  return allBlocks(spec)
    .filter(isTextBlock)
    .map(b => b.text)
}

/**
 * The share of recognised text the engine was confident about.
 *
 * Reported rather than hidden: a page of hairline type on a photograph will
 * score badly, and knowing that is more useful than a clean-looking file full
 * of plausible nonsense.
 */
export function textConfidence(spec: Spec): number {
  const blocks = allBlocks(spec).filter(isTextBlock)
  if (blocks.length === 0) return 0
  const total = blocks.reduce((sum, b) => sum + b.confidence, 0)
  return Math.round(total / blocks.length)
}
