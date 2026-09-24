import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Browsers that can take a screenshot from the command line, in the order they
 * are tried.
 *
 * Deliberately not Playwright or Puppeteer. Both would work, and both would add
 * a three hundred megabyte browser download to a tool whose entire job is to
 * read a picture. Every machine that renders web pages already has one of
 * these, and Chrome's headless screenshot flag has been stable for years.
 */
export const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
] as const

export async function findBrowser(override?: string): Promise<string | null> {
  // CHROME_PATH first after an explicit flag: it is how the container says
  // where its browser is, and how anyone with a non-standard install does too.
  const fromEnvironment = process.env.CHROME_PATH
  const candidates = [override, fromEnvironment, ...BROWSERS].filter(
    (c): c is string => typeof c === 'string' && c.length > 0,
  )
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

export interface CaptureOptions {
  width?: number
  height?: number
  /** Capture the whole scroll height rather than just the viewport. */
  fullPage?: boolean
  browser?: string
  timeoutMs?: number
}

export class NoBrowserError extends Error {
  constructor() {
    super(
      'No Chrome-family browser was found, so rendering cannot be checked.\n' +
        'Install Chrome, Chromium, Brave or Edge, or pass --browser <path>.\n' +
        'Everything except `calque check` works without one.',
    )
    this.name = 'NoBrowserError'
  }
}

/**
 * Render a local HTML file and write a PNG of it.
 *
 * `--hide-scrollbars` matters more than it looks: a scrollbar is a hairline of
 * high-contrast ink down the full height of the image, and it lands in the
 * measurement as a content edge, widening the detected container to the whole
 * canvas.
 */
export async function capture(htmlFile: string, pngFile: string, options: CaptureOptions = {}): Promise<string> {
  const browser = await findBrowser(options.browser)
  if (!browser) throw new NoBrowserError()

  const width = options.width ?? 1440
  const height = options.height ?? 900

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--virtual-time-budget=2500',
    `--window-size=${width},${height}`,
    `--screenshot=${pngFile}`,
  ]
  if (options.fullPage) args.push('--screenshot-format=png')
  args.push(new URL(`file://${htmlFile}`).href)

  try {
    await run(browser, args, { timeout: options.timeoutMs ?? 60_000 })
  } catch (error) {
    // Older builds reject `--headless=new` and want the bare flag.
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('headless')) throw error
    const legacy = args.map(a => (a === '--headless=new' ? '--headless' : a))
    await run(browser, legacy, { timeout: options.timeoutMs ?? 60_000 })
  }

  return pngFile
}
