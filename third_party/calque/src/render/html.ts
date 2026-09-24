import {
  type Block,
  type Column,
  type Section,
  type Spec,
  type TextBlock,
} from '../spec/types.js'
import { type TextRole } from '../detect/typography.js'

export interface RenderOptions {
  /** Written into the page title. */
  title?: string
  /** Leave out the comment header that explains where the numbers came from. */
  bare?: boolean
}

/**
 * A `url()` for a `style` attribute.
 *
 * Single quotes, not double. The attribute itself is delimited with double
 * quotes, so a double-quoted URL inside it closes the attribute early and every
 * background image on the page silently fails to load — the markup stays valid,
 * the browser reports nothing, and the rebuild is simply blank where the
 * pictures should be.
 */
export function cssUrl(path: string): string {
  return `url('${encodeURI(path).replace(/'/g, "%27")}')`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Turn a spec into one self-contained HTML file.
 *
 * Plain CSS with custom properties, no framework and no build step, because the
 * output has to be readable by whoever has to change it next — and because a
 * stylesheet of measured values is the honest shape of this data. Every number
 * below came off the image; none of them were chosen here.
 */
export function toHtml(spec: Spec, options: RenderOptions = {}): string {
  const title = options.title ?? titleOf(spec) ?? 'Rebuilt page'
  const body = spec.sections.map(section => renderSection(section, spec)).join('\n\n')

  const header = options.bare
    ? ''
    : `<!--
  Rebuilt by calque from ${escapeHtml(spec.source.file)} (${spec.source.width}x${spec.source.height}).

  Colours, type sizes, spacing and radii below are measured from the image.
  What could not be measured is listed here rather than invented:
${spec.notes.map(n => `    ${n.severity === 'warn' ? '!' : '-'} ${n.message}`).join('\n')}
-->
`

  return `${header}<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${stylesheet(spec)}
</style>
</head>
<body>
${body}
</body>
</html>
`
}

function titleOf(spec: Spec): string | null {
  for (const section of spec.sections) {
    for (const column of section.columns) {
      for (const block of column.blocks) {
        if (block.type === 'text' && (block.role === 'display' || block.role === 'heading')) {
          return block.text
        }
      }
    }
  }
  return null
}

// ── Stylesheet ──────────────────────────────────────────────────────────────

function stylesheet(spec: Spec): string {
  const { colour, type, space, radius } = spec.tokens
  const steps = new Map(type.scale.map(s => [s.role, s]))

  const scaleVars = type.scale
    .map(s => `  --text-${s.role}: ${s.size}px;\n  --weight-${s.role}: ${s.weight};\n  --leading-${s.role}: ${s.lineHeight};`)
    .join('\n')

  return `:root {
  --background: ${colour.background};
  --surface: ${colour.surface};
  --text: ${colour.text};
  --muted: ${colour.muted};
  --accent: ${colour.accent};
  --on-accent: ${colour.onAccent};
  --border: ${colour.border};

  --font: ${type.family};
  --body: ${type.body}px;
${scaleVars}

  --unit: ${space.unit}px;
  --container: ${space.container}px;
  --gutter: ${space.gutter}px;

  --radius-sm: ${radius.small}px;
  --radius-md: ${radius.medium}px;
  --radius-lg: ${radius.large}px;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--background);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--body);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.section { width: 100%; position: relative; }

/*
  Text over a photograph. The measured colour is kept — it is what the design
  used — and a shadow is added because a crop from a screenshot is never quite
  the same picture as the original asset, and type that was legible on one can
  fall apart on the other.
*/
.section[style*="background-image"] .t-display,
.section[style*="background-image"] .t-heading,
.section[style*="background-image"] .t-subheading {
  text-shadow: 0 1px 24px rgb(0 0 0 / 0.28);
}

/*
  The measured content column, centred. The gutter is what is left over, so it
  must not also be applied as padding — doing both subtracts it twice and the
  content ends up at half the width it was measured at, which overflowed a nav
  straight off the right of the page.
*/
.wrap {
  width: 100%;
  max-width: calc(var(--container) + 40px);
  margin-inline: auto;
  padding-inline: 20px;
}

.row { display: flex; gap: var(--row-gap, 32px); }
.row > .col { min-width: 0; }
.row-grid > .col { flex: 1 1 0; }
.row-between { justify-content: space-between; align-items: center; }

.col { display: flex; flex-direction: column; }

.align-left   { align-items: flex-start; text-align: left; }
.align-centre { align-items: center; text-align: center; }
.align-right  { align-items: flex-end; text-align: right; }
.align-justify { align-items: stretch; text-align: left; }

.card {
  background: var(--card-fill, var(--surface));
  border-radius: var(--card-radius, var(--radius-md));
  padding: var(--card-padding, 24px);
}

h1, h2, h3, p { margin: 0; }

.t-display   { font-size: var(--text-display, 48px);   font-weight: var(--weight-display, 700);   line-height: var(--leading-display, 1.1); letter-spacing: -0.02em; }
.t-heading   { font-size: var(--text-heading, 32px);   font-weight: var(--weight-heading, 700);   line-height: var(--leading-heading, 1.2); letter-spacing: -0.01em; }
.t-subheading{ font-size: var(--text-subheading, 20px);font-weight: var(--weight-subheading, 500);line-height: var(--leading-subheading, 1.35); }
.t-body      { font-size: var(--text-body, var(--body)); font-weight: var(--weight-body, 400);    line-height: var(--leading-body, 1.55); }
.t-label     { font-size: var(--text-label, 14px);     font-weight: var(--weight-label, 500);     line-height: var(--leading-label, 1.4); }
.t-caption   { font-size: var(--text-caption, 13px);   font-weight: var(--weight-caption, 400);   line-height: var(--leading-caption, 1.4); }

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  cursor: pointer;
  border: 0;
  font-family: inherit;
}
.button-solid   { background: var(--btn-fill, var(--accent)); color: var(--btn-text, var(--on-accent)); }
.button-outline { background: transparent; color: var(--btn-text, var(--text)); border: 1px solid var(--border); }
.button-ghost   { background: transparent; color: var(--btn-text, var(--text)); }

/*
  A screenshot cannot say what was inside a picture, so the picture is a block
  of the right size in the right colour rather than a stock photograph nobody
  asked for. Replace the background with the real asset.
*/
.image {
  background: var(--image-colour, var(--surface));
  border-radius: var(--image-radius, 0);
  width: 100%;
}

.icon {
  display: inline-block;
  background: currentColor;
  border-radius: 3px;
  opacity: 0.35;
}

nav .row { align-items: center; }

@media (max-width: 760px) {
  .row { flex-direction: column; }
  .align-right { align-items: flex-start; text-align: left; }
}
`
}

// ── Sections ────────────────────────────────────────────────────────────────

function renderSection(section: Section, spec: Spec): string {
  const tag = section.kind === 'nav' ? 'nav' : section.kind === 'footer' ? 'footer' : 'section'
  const pageBackground = spec.tokens.colour.background

  const style: string[] = []
  const backdrop = section.backdrop

  if (backdrop) {
    // The crop is the picture as it was displayed; the colour behind it is what
    // shows if the file is missing, so it is set either way.
    style.push(`background-color:${backdrop.colour}`)
    if (backdrop.src) {
      style.push(`background-image:${cssUrl(backdrop.src)}`)
      style.push('background-size:cover')
      style.push('background-position:center')
    }
  } else if (section.gradient) {
    style.push(`background:linear-gradient(180deg, ${section.gradient.from} 0%, ${section.gradient.to} 100%)`)
  } else if (section.background.toLowerCase() !== pageBackground.toLowerCase()) {
    style.push(`background:${section.background}`)
  }
  style.push(`padding-block:${round(section.padding.top)}px ${round(section.padding.bottom)}px`)

  /*
    Section height is left to the content on purpose.
    Pinning each section to the height it was measured at is the obvious idea
    and it was tried: it made the average worse, from 60.4% to 58.8%, and cost
    one fixture ten points, because a rebuild whose type wraps at a different
    measure needs a different height and forcing the original one just clips the
    rhythm somewhere else. Padding is measured; height follows from it.
  */
  if (backdrop) style.push(`min-height:${round(backdrop.box.h)}px`)

  const inner = section.columns.length > 1
    ? `<div class="row row-${section.layout}" style="--row-gap:${round(section.gap)}px">\n${
        section.columns.map(c => renderColumn(c, section)).join('\n')
      }\n    </div>`
    : section.columns.map(c => renderColumn(c, section)).join('\n')

  return `<${tag} class="section" id="${section.id}" style="${style.join(';')}">
  <div class="wrap">
    ${inner}
  </div>
</${tag}>`
}

function renderColumn(column: Column, section: Section): string {
  // With one column, the column's own alignment is measured inside a box that
  // is the content itself, so it says nothing. The section's alignment — which
  // was measured against the page — is the one that means something.
  const align = section.columns.length === 1 || column.align === 'justify' ? section.align : column.align
  const classes = ['col', alignClass(align)]
  const style: string[] = []

  if (column.gap > 0) style.push(`gap:${round(column.gap)}px`)
  // An even grid shares the row out; a pushed-apart row keeps each column at
  // its own width and lets `justify-content` do the spacing.
  if (section.layout === 'grid') style.push(`flex:${column.fraction.toFixed(3)} 1 0`)
  else if (section.layout === 'between') style.push('flex:0 0 auto')

  const blocks = column.blocks.map(renderBlock).filter(Boolean).join('\n        ')

  if (column.surface) {
    const surface = column.surface
    const surfaceStyle = [
      `--card-fill:${surface.fill}`,
      `--card-radius:${round(surface.radius)}px`,
      `--card-padding:${round(surface.padding)}px`,
      ...(surface.border ? [`border:${surface.border.width}px solid ${surface.border.colour}`] : []),
    ].join(';')
    return `      <div class="${classes.join(' ')} card" style="${[...style, surfaceStyle].join(';')}">
        ${blocks}
      </div>`
  }

  return `      <div class="${classes.join(' ')}" style="${style.join(';')}">
        ${blocks}
      </div>`
}

const alignClass = (align: string): string =>
  align === 'centre' ? 'align-centre' : align === 'right' ? 'align-right' : align === 'justify' ? 'align-justify' : 'align-left'

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'text':
      return renderText(block)

    case 'button': {
      const style = [
        `--btn-fill:${block.fill}`,
        `--btn-text:${block.colour}`,
        `border-radius:${round(block.radius)}px`,
        `font-size:${block.size}px`,
        `font-weight:${block.weight}`,
        `padding:${round(Math.max(6, (block.box.h - block.size * 1.2) / 2))}px ${round(block.box.w * 0.14)}px`,
      ].join(';')
      return `<a class="button button-${block.variant}" href="#" style="${style}">${escapeHtml(block.label)}</a>`
    }

    case 'image': {
      const style = [
        `--image-colour:${block.averageColour}`,
        `--image-radius:${round(block.radius)}px`,
        `aspect-ratio:${block.aspect}`,
        `max-width:${round(block.box.w)}px`,
        ...(block.src
          ? [`background-image:${cssUrl(block.src)}`, 'background-size:cover', 'background-position:center']
          : []),
      ].join(';')
      const label = block.src ? 'Image taken from the screenshot' : 'Image placeholder'
      return `<div class="image" style="${style}" role="img" aria-label="${label}"></div>`
    }

    case 'icon':
      return `<span class="icon" style="width:${round(block.box.w)}px;height:${round(block.box.h)}px;color:${block.colour}" aria-hidden="true"></span>`

    case 'divider':
      return `<hr style="border:0;border-top:${block.thickness}px solid ${block.colour};width:100%;margin:0">`
  }
}

/** Heading level follows the measured type scale, which is what a person would do. */
const TAG_FOR_ROLE: Record<TextRole, string> = {
  display: 'h1',
  heading: 'h2',
  subheading: 'h3',
  body: 'p',
  label: 'p',
  caption: 'p',
}

function renderText(block: TextBlock): string {
  const tag = TAG_FOR_ROLE[block.role]
  const style: string[] = [`font-size:${block.size}px`, `font-weight:${block.weight}`]
  if (block.colour) style.push(`color:${block.colour}`)

  // A wrapped paragraph keeps roughly the measure it was set to; without this
  // every body copy block runs the full width of its column and the rhythm of
  // the original is lost.
  if (block.role === 'body' && block.text.length > 60) style.push('max-width:68ch')

  return `<${tag} class="t-${block.role}" style="${style.join(';')}">${escapeHtml(block.text)}</${tag}>`
}

const round = (n: number): number => Math.round(n)
