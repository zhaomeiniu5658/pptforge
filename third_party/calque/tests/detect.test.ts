import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { hex, rgb } from '../src/core/colour.js'
import { box } from '../src/core/geom.js'
import { blank, fillBox } from '../src/core/image.js'
import { detectFrame, hasFrame } from '../src/detect/frame.js'
import { alignmentOf, colourBoundaries, contentBox, sectionGap, spacingUnit } from '../src/detect/layout.js'
import { derivePalette, pickAccent, quantise, regionColour } from '../src/detect/palette.js'
import { groupLines, INK_OVERSHOOT, separateContainers, shrink } from '../src/detect/regions.js'
import { bandCoverage, coversBand, photoRegions, snapToEdges } from '../src/detect/photos.js'
import { cornerRadius, expandSurface, isUniform, looksLikeButton } from '../src/detect/surfaces.js'
import {
  buildScale,
  bodySize,
  estimateFontSize,
  estimateWeight,
  METRICS,
  roleForSize,
  spanFor,
  strokeWidth,
  tidySize,
  WEIGHTS,
} from '../src/detect/typography.js'

const piece = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, pixels: w * h })

describe('typography', () => {
  it('measures the string, not just the box', () => {
    // The bounding box of a run measures which letters are in it. "Come on"
    // and "Coming" are the same type at different ink heights.
    assert.equal(spanFor('Coming'), METRICS.ascender + METRICS.descender)
    assert.equal(spanFor('COME'), METRICS.ascender)
    assert.equal(spanFor('non'), METRICS.xHeight)
    assert.equal(spanFor('gum'), METRICS.xHeight + METRICS.descender)
  })

  it('recovers font size from ink height', () => {
    const size = estimateFontSize(46, 'Ship the thing today')
    assert.ok(Math.abs(size - 48) < 4, `got ${size}`)
  })

  it('never emits a weight it cannot resolve', () => {
    // 600 and 700 overlap in measured stroke ratio, so 600 is not offered.
    assert.ok(!WEIGHTS.includes(600 as never))
    for (const stroke of [0.5, 1.4, 2.2, 3.4, 8]) {
      assert.ok(WEIGHTS.includes(estimateWeight(stroke, 16)))
    }
  })

  it('separates regular from bold at the measured ratios', () => {
    // Fitted on the fixture: regular ran 0.096–0.117, bold 0.149–0.183.
    assert.equal(estimateWeight(0.10 * 16, 16), 400)
    assert.equal(estimateWeight(0.117 * 16, 16), 400)
    assert.equal(estimateWeight(0.17 * 16, 16), 700)
    assert.equal(estimateWeight(0, 16), 400, 'no measurement means no claim')
  })

  it('averages stroke runs rather than taking a median', () => {
    // An integer median is 1 or 2 at small sizes and nothing between, which is
    // a 100% step across the whole range that separates regular from bold.
    const mask = { width: 10, height: 2, data: new Uint8Array(20) }
    mask.data[0] = 1
    mask.data[4] = 1
    mask.data[5] = 1
    const width = strokeWidth(mask, box(0, 0, 10, 2))
    assert.ok(width > 1 && width < 2, `expected a fraction, got ${width}`)
  })

  it('clusters near-misses into one step', () => {
    const scale = buildScale([15.8, 16.1, 16.0, 47.6, 48.2])
    assert.equal(scale.length, 2)
    assert.deepEqual(scale.map(s => s.size), [48, 16])
  })

  it('takes body from the most-used plausible size', () => {
    assert.equal(bodySize([{ size: 48, count: 1 }, { size: 16, count: 9 }, { size: 11, count: 12 }]), 16)
  })

  it('names roles by ratio to body', () => {
    assert.equal(roleForSize(48, 16), 'display')
    assert.equal(roleForSize(16, 16), 'body')
    assert.equal(roleForSize(11, 16), 'caption')
  })

  it('rounds to values a person would type', () => {
    assert.equal(tidySize(15.6), 16)
    assert.equal(tidySize(47.3), 48)
  })
})

describe('regions', () => {
  it('joins letters into a word but not two elements', () => {
    const word = groupLines([piece(0, 0, 8, 12), piece(10, 0, 8, 12), piece(20, 0, 8, 12)])
    assert.equal(word.length, 1)
    assert.equal(word[0]?.w, 28)

    const apart = groupLines([piece(0, 0, 8, 12), piece(120, 0, 8, 12)])
    assert.equal(apart.length, 2)
  })

  it('keeps different type sizes apart', () => {
    const mixed = groupLines([piece(0, 0, 8, 10), piece(10, 0, 8, 60)])
    assert.equal(mixed.length, 2)
  })

  it('keeps stacked lines apart', () => {
    assert.equal(groupLines([piece(0, 0, 40, 12), piece(0, 40, 40, 12)]).length, 2)
  })

  it('treats a hollow box that encloses text as a container', () => {
    // An input's border merges with its placeholder and the whole control reads
    // as one huge line, so the same words land twice at two different sizes.
    const outline = { x: 0, y: 0, w: 200, h: 60, pixels: 500, parts: 1 }
    const inside = { x: 20, y: 20, w: 100, h: 18, pixels: 600, parts: 1 }
    const { lines, containers } = separateContainers([outline, inside])
    assert.deepEqual(containers, [outline])
    assert.deepEqual(lines, [inside])
  })

  it('does not call a solid word a container', () => {
    const solid = { x: 0, y: 0, w: 200, h: 60, pixels: 200 * 60 * 0.8, parts: 1 }
    const inside = { x: 20, y: 20, w: 40, h: 18, pixels: 300, parts: 1 }
    assert.equal(separateContainers([solid, inside]).containers.length, 0)
  })

  it('shrinks by the measured ink rim', () => {
    assert.equal(INK_OVERSHOOT, 1)
    assert.deepEqual(shrink({ x: 10, y: 10, w: 20, h: 20, pixels: 1, parts: 1 }, 1), { x: 11, y: 11, w: 18, h: 18, pixels: 1, parts: 1 })
  })

  it('never shrinks a box out of existence', () => {
    const tiny = { x: 5, y: 5, w: 3, h: 3, pixels: 1, parts: 1 }
    const shrunk = shrink(tiny, 4)
    assert.ok(shrunk.w >= 1 && shrunk.h >= 1)
  })
})

describe('frame', () => {
  it('finds a window border', () => {
    const raster = blank(200, 200, rgb(9, 11, 10))
    fillBox(raster, box(10, 10, 180, 180), rgb(250, 250, 250))
    const frame = detectFrame(raster)
    assert.ok(hasFrame(frame))
    assert.ok(frame.thickness.top >= 10 && frame.thickness.top <= 12)
  })

  it('refuses to eat page margins', () => {
    // A centred layout on white has 200px of pure white down each side, which
    // passes every "uniform border" test there is. Cropping it destroys exactly
    // the measurement the gutter and container come from.
    const raster = blank(400, 200, rgb(255, 255, 255))
    fillBox(raster, box(150, 80, 100, 40), rgb(20, 20, 20))
    const frame = detectFrame(raster)
    assert.equal(hasFrame(frame), false)
    assert.equal(frame.content.w, 400)
  })

  it('ignores a design that merely has a dark top', () => {
    const raster = blank(200, 200, rgb(255, 255, 255))
    fillBox(raster, box(0, 0, 200, 20), rgb(0, 0, 0))
    assert.equal(hasFrame(detectFrame(raster)), false)
  })
})

describe('layout', () => {
  it('measures the content column from elements, not raw ink', () => {
    const found = contentBox([box(200, 30, 100, 20), box(900, 30, 100, 20)], { width: 1440, height: 800 })
    assert.equal(found.x, 200)
    assert.equal(found.w, 800)
  })

  it('ignores a stray mark in the corner', () => {
    const real = Array.from({ length: 20 }, (_, i) => box(200 + i, 100 + i * 10, 400, 20))
    const withNoise = [box(0, 0, 4, 4), ...real, box(1436, 790, 4, 4)]
    const found = contentBox(withNoise, { width: 1440, height: 800 })
    assert.ok(found.x >= 200, `left edge dragged to ${found.x}`)
  })

  it('scales the section gap to the page', () => {
    // A fixed threshold split one hero into three sections, because 30px of
    // breathing room inside it cleared the same bar as 109px between sections.
    const tight = Array.from({ length: 8 }, (_, i) => box(0, i * 30, 100, 10))
    const airy = Array.from({ length: 8 }, (_, i) => box(0, i * 200, 100, 10))
    assert.ok(sectionGap(airy, 2000) > sectionGap(tight, 2000))
  })

  it('does not find a boundary in a smooth gradient', () => {
    const gradient = Array.from({ length: 400 }, (_, i) => rgb(i / 4, i / 4, i / 4))
    assert.deepEqual(colourBoundaries(gradient), [])
  })

  it('finds a real step', () => {
    const stepped = [
      ...Array.from({ length: 200 }, () => rgb(255, 255, 255)),
      ...Array.from({ length: 200 }, () => rgb(20, 20, 20)),
    ]
    const found = colourBoundaries(stepped)
    assert.equal(found.length, 1)
    assert.ok(Math.abs((found[0] as number) - 200) < 14)
  })

  it('reads alignment from the tightest edge', () => {
    const container = box(0, 0, 1000, 400)
    assert.equal(alignmentOf([box(100, 0, 50, 10), box(100, 20, 90, 10)], container), 'left')
    assert.equal(alignmentOf([box(400, 0, 200, 10), box(450, 20, 100, 10)], container), 'centre')
    assert.equal(alignmentOf([box(700, 0, 200, 10), box(800, 20, 100, 10)], container), 'right')
  })

  it('finds the spacing rhythm', () => {
    assert.equal(spacingUnit([8, 16, 24, 32, 8]), 8)
    assert.equal(spacingUnit([]), 8, 'a sane default rather than a wrong answer')
  })
})

describe('palette', () => {
  it('quantises to the dominant colours', () => {
    const pixels = [...Array(90).fill(rgb(255, 255, 255)), ...Array(10).fill(rgb(0, 0, 0))]
    const swatches = quantise(pixels, 4)
    assert.deepEqual(swatches[0]?.colour, rgb(255, 255, 255))
    assert.ok((swatches[0]?.share ?? 0) > 0.85)
  })

  it('reads type colour without the ink mask', () => {
    // The global mask finds only the *edges* of large glyphs, and edge pixels
    // are the blend of the type and what is behind it: a white headline on a
    // green page measured as a green that is nowhere on the page.
    const raster = blank(100, 40, rgb(4, 33, 21))
    fillBox(raster, box(10, 10, 40, 20), rgb(255, 255, 255))
    const found = regionColour(raster, box(0, 0, 100, 40))
    assert.equal(hex(found.background), '#042115')
    assert.equal(hex(found.foreground), '#ffffff')
  })

  it('picks an accent that is actually on the page', () => {
    const accent = pickAccent(
      [{ colour: rgb(37, 99, 235), share: 0.05 }, { colour: rgb(250, 250, 250), share: 0.9 }],
      rgb(255, 255, 255),
      rgb(17, 17, 17),
    )
    assert.equal(hex(accent), '#2563eb')
  })

  it('does not invent an accent for a page that has none', () => {
    const accent = pickAccent(
      [{ colour: rgb(250, 250, 250), share: 0.9 }, { colour: rgb(30, 30, 30), share: 0.1 }],
      rgb(255, 255, 255),
      rgb(17, 17, 17),
    )
    assert.ok(saturationOf(accent) < 0.2, `invented ${hex(accent)}`)
  })

  it('derives a readable set of tokens', () => {
    const palette = derivePalette({
      background: rgb(255, 255, 255),
      textColours: [{ colour: rgb(51, 51, 51), share: 0.7 }, { colour: rgb(120, 120, 120), share: 0.3 }],
      overall: [{ colour: rgb(37, 99, 235), share: 0.05 }],
    })
    assert.equal(palette.dark, false)
    assert.equal(hex(palette.text), '#333333')
    assert.equal(hex(palette.onAccent), '#ffffff')
  })
})

const saturationOf = (c: { r: number; g: number; b: number }): number => {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  return max === 0 ? 0 : (max - min) / max
}

describe('surfaces', () => {
  const card = (): ReturnType<typeof blank> => {
    const raster = blank(300, 200, rgb(250, 250, 250))
    fillBox(raster, box(50, 40, 200, 120), rgb(244, 244, 245))
    return raster
  }

  it('expands to the panel, not to the page', () => {
    const found = expandSurface(card(), { x: 150, y: 100 }, rgb(244, 244, 245), 2)
    assert.equal(found?.x, 50)
    assert.equal(found?.w, 200)
    assert.equal(found?.h, 120)
  })

  it('passes through a row of text rather than stopping at it', () => {
    // At 0.82 coverage a 130px card measured 38px tall, ending exactly where
    // its heading began.
    const raster = card()
    for (let i = 0; i < 14; i++) fillBox(raster, box(60 + i * 8, 90, 4, 12), rgb(17, 17, 17))
    const found = expandSurface(raster, { x: 150, y: 60 }, rgb(244, 244, 245), 2)
    assert.ok((found?.h ?? 0) > 100, `stopped at the text: ${found?.h}`)
  })

  it('refuses a rectangle that is really a gradient', () => {
    const raster = blank(300, 200, rgb(0, 0, 0))
    for (let x = 0; x < 300; x++) fillBox(raster, box(x, 0, 1, 200), rgb(x / 2, 200 - x / 2, 120))
    assert.equal(isUniform(raster, box(0, 0, 300, 200), rgb(0, 100, 120), 3), false)
  })

  it('accepts a rectangle that really is flat', () => {
    assert.equal(isUniform(card(), box(50, 40, 200, 120), rgb(244, 244, 245), 3), true)
  })

  it('measures a corner radius', () => {
    // A square corner is zero; a bevelled one is not.
    const square = blank(120, 120, rgb(255, 255, 255))
    fillBox(square, box(20, 20, 80, 80), rgb(0, 0, 0))
    assert.equal(cornerRadius(square, box(20, 20, 80, 80), rgb(0, 0, 0), 3), 0)

    const rounded = blank(120, 120, rgb(255, 255, 255))
    fillBox(rounded, box(20, 20, 80, 80), rgb(0, 0, 0))
    for (let y = 0; y < 12; y++) {
      const inset = Math.round(12 - Math.sqrt(Math.max(0, 144 - (12 - y) ** 2)))
      fillBox(rounded, box(20, 20 + y, inset, 1), rgb(255, 255, 255))
      fillBox(rounded, box(100 - inset, 20 + y, inset, 1), rgb(255, 255, 255))
      fillBox(rounded, box(20, 99 - y, inset, 1), rgb(255, 255, 255))
      fillBox(rounded, box(100 - inset, 99 - y, inset, 1), rgb(255, 255, 255))
    }
    const measured = cornerRadius(rounded, box(20, 20, 80, 80), rgb(0, 0, 0), 3)
    assert.ok(Math.abs(measured - 12) <= 4, `expected about 12, got ${measured}`)
  })

  it('tells a control from a card', () => {
    const button = { x: 0, y: 0, w: 140, h: 44, fill: rgb(37, 99, 235), radius: 8, border: null }
    const panel = { x: 0, y: 0, w: 325, h: 200, fill: rgb(244, 244, 245), radius: 12, border: null }
    assert.equal(looksLikeButton(button, box(20, 12, 100, 18), { width: 1440 }), true)
    assert.equal(looksLikeButton(panel, box(20, 12, 100, 18), { width: 1440 }), false)
  })
})

describe('photographs', () => {
  it('tells a photograph from flat interface', () => {
    const flat = blank(240, 240, rgb(250, 250, 250))
    fillBox(flat, box(20, 20, 200, 40), rgb(17, 17, 17))
    assert.equal(photoRegions(flat).length, 0, 'text is bimodal, not photographic')

    const photo = blank(240, 240, rgb(0, 0, 0))
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 240; x++) {
        fillBox(photo, box(x, y, 1, 1), rgb((x * 7 + y * 13) % 256, (x * 3 + y * 29) % 256, (x * 17 + y * 5) % 256))
      }
    }
    assert.ok(photoRegions(photo).length > 0)
  })

  it('sums coverage across the pieces of one picture', () => {
    // A headline splits a hero photograph into a piece above and a piece below,
    // and each half alone is under any sensible single-region threshold.
    const band = box(0, 0, 1000, 800)
    const halves = [box(0, 0, 1000, 300), box(0, 400, 1000, 400)]
    assert.ok(halves.every(h => bandCoverage(h, band) < 0.55))
    assert.equal(coversBand(halves, band), true)
  })

  it('snaps a full-bleed picture to the edge it nearly reaches', () => {
    const snapped = snapToEdges(
      { x: 0, y: 216, w: 1512, h: 644, averageColour: rgb(1, 2, 3), coverage: 0.75 },
      { width: 1512, height: 860 },
    )
    assert.equal(snapped.y, 0)
    assert.equal(snapped.h, 860)
  })

  it('leaves an inset picture alone', () => {
    const inset = { x: 100, y: 216, w: 400, h: 300, averageColour: rgb(1, 2, 3), coverage: 0.1 }
    assert.deepEqual(snapToEdges(inset, { width: 1512, height: 860 }), inset)
  })
})
