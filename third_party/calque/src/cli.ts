#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extract } from './spec/assemble.js'
import { writeAssets } from './spec/assets.js'
import { toHtml } from './render/html.js'
import { type Spec, textConfidence } from './spec/types.js'
import { capture, NoBrowserError } from './verify/capture.js'
import { compare, diffImage } from './verify/compare.js'

const USAGE = `calque — turn a screenshot of a page into working HTML and CSS

  calque build <image> [-o out.html]     read the image and write a page
  calque extract <image> [-o spec.json]  read the image and write the spec only
  calque render <spec.json> [-o out.html]  turn a spec into a page
  calque check <image> <page.html>       render the page and score it against the image

Options
  -o, --out <path>      where to write (default: alongside the input)
  --spec <path>         with build: also write the spec it measured
  --assets <dir>        cut detected photographs out of the screenshot into <dir>
  --diff <path>         with check: write a side-by-side PNG
  --width <px>          viewport width for check (default: the image width)
  --browser <path>      Chrome-family binary for check
  --lang <code>         OCR language (default: eng)
  --quiet               no progress output
  -h, --help            this

Every colour, size, position and radius in the output is measured from the
image. Nothing is inferred by a model, and nothing is invented: what could not
be read is reported in the spec's notes and in a comment at the top of the HTML.
`

interface Args {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string
    if (!token.startsWith('-')) {
      positional.push(token)
      continue
    }
    const name = token.replace(/^-+/, '')
    const alias = name === 'o' ? 'out' : name === 'h' ? 'help' : name
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('-') && alias !== 'help' && alias !== 'quiet') {
      flags[alias] = next
      i++
    } else {
      flags[alias] = true
    }
  }

  return { command: positional[0] ?? '', positional: positional.slice(1), flags }
}

const say = (quiet: boolean) => (message: string): void => {
  if (!quiet) process.stderr.write(`${message}\n`)
}

async function writeOut(path: string, contents: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

function swap(file: string, extension: string): string {
  return file.replace(/\.[^./\\]+$/, '') + extension
}

/** A short, honest summary of what was and was not read. */
function summarise(spec: Spec, log: (m: string) => void): void {
  const blocks = spec.sections.flatMap(s => s.columns.flatMap(c => c.blocks))
  const text = blocks.filter(b => b.type === 'text').length
  const buttons = blocks.filter(b => b.type === 'button').length
  const images = blocks.filter(b => b.type === 'image' || b.type === 'icon').length

  log('')
  log(`  ${spec.sections.length} sections · ${text} text · ${buttons} buttons · ${images} images and icons`)
  log(`  text confidence ${textConfidence(spec)}%  ·  read in ${spec.source.tookMs ?? 0}ms`)
  log(`  ${spec.tokens.colour.dark ? 'dark' : 'light'} · bg ${spec.tokens.colour.background} · text ${spec.tokens.colour.text} · accent ${spec.tokens.colour.accent}`)
  log(`  body ${spec.tokens.type.body}px · container ${spec.tokens.space.container}px · gutter ${spec.tokens.space.gutter}px`)

  const warnings = spec.notes.filter(n => n.severity === 'warn')
  for (const note of warnings) log(`  ! ${note.message}`)
  log('')
}

async function main(argv: readonly string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv)
  const quiet = flags.quiet === true
  const log = say(quiet)

  if (flags.help || command === '' || command === 'help') {
    process.stdout.write(USAGE)
    return 0
  }

  const progress = quiet
    ? undefined
    : (stage: string, done?: number, total?: number): void => {
        const suffix = total ? ` ${done}/${total}` : ''
        process.stderr.write(`\r  ${stage}${suffix}${' '.repeat(20)}`)
        if (stage === 'laying out') process.stderr.write('\n')
      }

  switch (command) {
    case 'extract': {
      const image = positional[0]
      if (!image) throw new Error('calque extract needs an image')
      const spec = await extract(image, { onProgress: progress, language: asString(flags.lang) })
      const out = asString(flags.out) ?? swap(image, '.calque.json')
      await writeOut(out, JSON.stringify(spec, null, 2))
      summarise(spec, log)
      log(`  spec -> ${out}`)
      return 0
    }

    case 'render': {
      const specFile = positional[0]
      if (!specFile) throw new Error('calque render needs a spec file')
      const spec = JSON.parse(await readFile(specFile, 'utf8')) as Spec
      const out = asString(flags.out) ?? swap(specFile, '.html')
      await writeOut(out, toHtml(spec))
      log(`  page -> ${out}`)
      return 0
    }

    case 'build': {
      const image = positional[0]
      if (!image) throw new Error('calque build needs an image')
      const spec = await extract(image, { onProgress: progress, language: asString(flags.lang) })
      const out = asString(flags.out) ?? swap(image, '.html')

      const assets = asString(flags.assets)
      if (assets) {
        await writeAssets(spec, image, { directory: assets, relativeTo: dirname(resolve(out)) })
        log(`  assets -> ${assets}`)
      }
      await writeOut(out, toHtml(spec))
      summarise(spec, log)

      const specOut = asString(flags.spec)
      if (specOut) {
        await writeOut(specOut, JSON.stringify(spec, null, 2))
        log(`  spec -> ${specOut}`)
      }
      log(`  page -> ${out}`)
      return 0
    }

    case 'check': {
      const image = positional[0]
      const page = positional[1]
      if (!image || !page) throw new Error('calque check needs an image and an HTML file')

      const { dimensions } = await import('./core/image.js')
      const size = await dimensions(image)
      const width = Number(asString(flags.width) ?? size.width)

      const shot = swap(page, '.rendered.png')
      log(`  rendering ${page} at ${width}px wide`)
      await capture(resolve(page), shot, {
        width,
        height: size.height,
        browser: asString(flags.browser),
      })

      const result = await compare(image, shot)
      log('')
      log(`  match ${(result.score * 100).toFixed(1)}%  ·  ${(result.differing * 100).toFixed(1)}% of pixels differ  ·  mean ΔE ${result.meanDelta.toFixed(1)}`)

      const diff = asString(flags.diff)
      if (diff) {
        await diffImage(image, shot, diff)
        log(`  original | differences | rebuild -> ${diff}`)
      }
      log(`  render -> ${shot}`)
      return result.score > 0.5 ? 0 : 1
    }

    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
      return 2
  }
}

const asString = (value: string | boolean | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

/**
 * Only run when this file *is* the command, not when something imports it.
 *
 * Without this guard, importing `parseArgs` from a test ran the whole CLI:
 * it printed the usage text and called `process.exit(0)` while the test file
 * was still being loaded. Every test in that file then silently did not run,
 * and the runner reported the file as passing — the worst possible failure,
 * because it looks exactly like success.
 */
const invokedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  run()
}

function run(): void {
  main(process.argv.slice(2))
  .then(code => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof NoBrowserError) {
      process.stderr.write(`\n${error.message}\n`)
      process.exit(3)
    }
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
