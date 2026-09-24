export interface Rgb {
  r: number
  g: number
  b: number
}

export const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b })

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

export function hex(c: Rgb): string {
  const part = (n: number): string => clamp255(n).toString(16).padStart(2, '0')
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`
}

export function parseHex(value: string): Rgb | null {
  const text = value.trim().replace(/^#/, '')
  const full = text.length === 3 ? text.split('').map(ch => ch + ch).join('') : text
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** WCAG relative luminance. Drives every light-or-dark decision in the pipeline. */
export function luminance(c: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

export const isDark = (c: Rgb): boolean => luminance(c) < 0.5

/**
 * Perceptual distance in CIE76 ΔE.
 *
 * Euclidean RGB distance calls `#00ff00` and `#0000ff` about as different as
 * `#000000` and `#333333`, which wrecks palette clustering. Lab does not.
 */
export function distance(a: Rgb, b: Rgb): number {
  const la = toLab(a)
  const lb = toLab(b)
  return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b)
}

export interface Lab {
  l: number
  a: number
  b: number
}

export function toLab(c: Rgb): Lab {
  const linear = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = linear(c.r)
  const g = linear(c.g)
  const b = linear(c.b)

  // sRGB D65
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** Saturation in HSL terms, 0 to 1. Separates a brand colour from a grey. */
export function saturation(c: Rgb): number {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  if (max === min) return 0
  const l = (max + min) / 2 / 255
  const d = (max - min) / 255
  return l > 0.5 ? d / (2 - max / 255 - min / 255) : d / (max / 255 + min / 255)
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t))
  return {
    r: clamp255(a.r + (b.r - a.r) * k),
    g: clamp255(a.g + (b.g - a.g) * k),
    b: clamp255(a.b + (b.b - a.b) * k),
  }
}

/** Nudge a colour towards white or black, whichever moves away from it. */
export function shade(c: Rgb, amount: number): Rgb {
  return mix(c, isDark(c) ? rgb(255, 255, 255) : rgb(0, 0, 0), amount)
}

export function toCss(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? hex(c) : `rgb(${clamp255(c.r)} ${clamp255(c.g)} ${clamp255(c.b)} / ${alpha})`
}
