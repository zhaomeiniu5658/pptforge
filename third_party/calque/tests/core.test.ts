import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { contrast, distance, hex, isDark, luminance, mix, parseHex, rgb, saturation, shade } from '../src/core/colour.js'
import { area, box, clamp, contains, intersect, overlapRatio, pad, union, unionAll, verticalOverlap } from '../src/core/geom.js'
import { blank, blur, crop, fillBox, greyscale, samples } from '../src/core/image.js'
import { components, dilateHorizontal, dilateVertical, emptyMask, inkMask, luminanceInkMask, runsAbove, runsBelow } from '../src/core/mask.js'

describe('colour', () => {
  it('round trips through hex', () => {
    assert.equal(hex(rgb(255, 0, 128)), '#ff0080')
    assert.deepEqual(parseHex('#ff0080'), rgb(255, 0, 128))
    assert.deepEqual(parseHex('f08'), rgb(255, 0, 136))
  })

  it('rejects nonsense rather than guessing', () => {
    assert.equal(parseHex('nope'), null)
    assert.equal(parseHex('#12345'), null)
  })

  it('puts white above black', () => {
    assert.ok(luminance(rgb(255, 255, 255)) > luminance(rgb(0, 0, 0)))
    assert.equal(Math.round(contrast(rgb(255, 255, 255), rgb(0, 0, 0))), 21)
  })

  it('knows a dark theme from a light one', () => {
    assert.equal(isDark(rgb(4, 33, 21)), true)
    assert.equal(isDark(rgb(250, 250, 250)), false)
  })

  it('separates hues that Euclidean RGB distance calls equal', () => {
    // The reason distance is measured in Lab. Green against blue is a large
    // perceptual difference; near-blacks are a small one. Plain RGB says the
    // opposite, and palette clustering built on it merges the wrong colours.
    const greenToBlue = distance(rgb(0, 255, 0), rgb(0, 0, 255))
    const blackToCharcoal = distance(rgb(0, 0, 0), rgb(51, 51, 51))
    assert.ok(greenToBlue > blackToCharcoal * 2, `${greenToBlue} vs ${blackToCharcoal}`)
  })

  it('tells a brand colour from a grey', () => {
    assert.ok(saturation(rgb(37, 99, 235)) > 0.5)
    assert.ok(saturation(rgb(128, 128, 128)) < 0.01)
  })

  it('shades away from itself', () => {
    assert.ok(luminance(shade(rgb(0, 0, 0), 0.5)) > 0)
    assert.ok(luminance(shade(rgb(255, 255, 255), 0.5)) < 1)
  })

  it('mixes proportionally and clamps the ends', () => {
    assert.deepEqual(mix(rgb(0, 0, 0), rgb(100, 100, 100), 0.5), rgb(50, 50, 50))
    assert.deepEqual(mix(rgb(0, 0, 0), rgb(100, 100, 100), 5), rgb(100, 100, 100))
  })
})

describe('geometry', () => {
  it('unions and intersects', () => {
    assert.deepEqual(union(box(0, 0, 10, 10), box(5, 5, 10, 10)), box(0, 0, 15, 15))
    assert.deepEqual(intersect(box(0, 0, 10, 10), box(5, 5, 10, 10)), box(5, 5, 5, 5))
    assert.equal(intersect(box(0, 0, 4, 4), box(9, 9, 4, 4)), null)
  })

  it('returns null for an empty union rather than a zero box', () => {
    assert.equal(unionAll([]), null)
    assert.deepEqual(unionAll([box(2, 3, 4, 5)]), box(2, 3, 4, 5))
  })

  it('measures overlap against the smaller box', () => {
    assert.equal(overlapRatio(box(0, 0, 100, 100), box(0, 0, 10, 10)), 1)
    assert.equal(overlapRatio(box(0, 0, 10, 10), box(50, 50, 10, 10)), 0)
  })

  it('groups words into lines by vertical overlap', () => {
    assert.ok(verticalOverlap(box(0, 10, 5, 20), box(30, 12, 5, 20)) > 0.8)
    assert.equal(verticalOverlap(box(0, 0, 5, 10), box(0, 40, 5, 10)), 0)
  })

  it('pads without escaping the image', () => {
    // This cancelled to a no-op when it was written by hand; it is now clamp of
    // the naive expansion, which is obviously correct.
    const padded = pad(box(1, 1, 10, 10), 5, { width: 20, height: 20 })
    assert.deepEqual(padded, box(0, 0, 16, 16))
    assert.equal(area(pad(box(0, 0, 20, 20), 5, { width: 20, height: 20 })), 400)
  })

  it('clamps and contains', () => {
    assert.deepEqual(clamp(box(-5, -5, 20, 20), { width: 10, height: 10 }), box(0, 0, 10, 10))
    assert.equal(contains(box(0, 0, 10, 10), box(2, 2, 3, 3)), true)
    assert.equal(contains(box(0, 0, 10, 10), box(8, 8, 5, 5)), false)
  })
})

describe('image', () => {
  it('greyscales by luma, not by average', () => {
    const raster = blank(1, 1, rgb(0, 255, 0))
    // Green carries most of the luminance; a plain mean would say 85.
    assert.ok((greyscale(raster)[0] ?? 0) > 170)
  })

  it('blurs towards the neighbourhood', () => {
    const width = 9
    const data = new Uint8ClampedArray(width)
    data[4] = 255
    const blurred = blur(data, width, 1, 2)
    assert.ok((blurred[4] ?? 0) < 255)
    assert.ok((blurred[3] ?? 0) > 0, 'brightness should spread sideways')
  })

  it('leaves a flat field flat', () => {
    const data = new Uint8ClampedArray(20).fill(128)
    const blurred = blur(data, 20, 1, 3)
    for (const value of blurred) assert.ok(Math.abs(value - 128) <= 1)
  })

  it('crops a region out', () => {
    const raster = blank(10, 10, rgb(255, 255, 255))
    fillBox(raster, box(2, 2, 3, 3), rgb(0, 0, 0))
    const cropped = crop(raster, box(2, 2, 3, 3))
    assert.equal(cropped.width, 3)
    assert.ok(samples(cropped, box(0, 0, 3, 3)).every(p => p.r === 0))
  })
})

describe('ink mask', () => {
  it('finds dark text on light and light text on dark alike', () => {
    const light = blank(60, 30, rgb(255, 255, 255))
    fillBox(light, box(20, 12, 12, 6), rgb(0, 0, 0))
    const dark = blank(60, 30, rgb(10, 10, 10))
    fillBox(dark, box(20, 12, 12, 6), rgb(255, 255, 255))

    for (const raster of [light, dark]) {
      const mask = inkMask(raster, { threshold: 40, radius: 4 })
      const found = components(mask, 4)
      assert.equal(found.length, 1, 'exactly one mark either way round')
    }
  })

  it('finds nothing in a smooth gradient', () => {
    // The whole reason for subtracting a local background instead of
    // thresholding on brightness.
    const raster = blank(200, 60, rgb(0, 0, 0))
    for (let x = 0; x < 200; x++) {
      fillBox(raster, box(x, 0, 1, 60), rgb(x, x / 2, 255 - x))
    }
    const mask = inkMask(raster, { threshold: 40, radius: 6 })
    const found = components(mask, 20)
    assert.equal(found.length, 0)
  })

  it('sees colour that luminance alone misses', () => {
    // A mint headline over a green glow measured almost identical luma, and
    // luminance-only detection lost the letters that sat on the brightest part.
    const raster = blank(60, 30, rgb(20, 130, 90))
    fillBox(raster, box(20, 12, 12, 6), rgb(130, 120, 20)) // same luma, other hue

    assert.equal(components(luminanceInkMask(raster, { threshold: 30, radius: 4 }), 4).length, 0)
    assert.equal(components(inkMask(raster, { threshold: 30, radius: 4 }), 4).length, 1)
  })
})

describe('mask operations', () => {
  it('dilates sideways without merging separate lines', () => {
    const mask = emptyMask(20, 5)
    mask.data[2 * 20 + 3] = 1
    const wide = dilateHorizontal(mask, 2)
    assert.equal(wide.data[2 * 20 + 1], 1)
    assert.equal(wide.data[2 * 20 + 5], 1)
    assert.equal(wide.data[2 * 20 + 6], 0)
    assert.equal(wide.data[1 * 20 + 3], 0, 'horizontal dilation must not move vertically')
  })

  it('dilates vertically', () => {
    const mask = emptyMask(5, 20)
    mask.data[10 * 5 + 2] = 1
    const tall = dilateVertical(mask, 1)
    assert.equal(tall.data[9 * 5 + 2], 1)
    assert.equal(tall.data[11 * 5 + 2], 1)
    assert.equal(tall.data[8 * 5 + 2], 0)
  })

  it('labels components without blowing the call stack', () => {
    // Flood fill is iterative for this reason: one component on a real page is
    // routinely a hundred thousand pixels.
    const mask = emptyMask(400, 400)
    mask.data.fill(1)
    const found = components(mask, 1)
    assert.equal(found.length, 1)
    assert.equal(found[0]?.pixels, 160_000)
  })

  it('keeps separate blobs separate', () => {
    const mask = emptyMask(20, 20)
    mask.data[2 * 20 + 2] = 1
    mask.data[15 * 20 + 15] = 1
    assert.equal(components(mask, 1).length, 2)
  })

  it('finds runs above and below a floor', () => {
    const profile = [0, 0, 5, 6, 0, 0, 0, 9]
    assert.deepEqual(runsAbove(profile, 0), [{ start: 2, end: 4 }, { start: 7, end: 8 }])
    assert.deepEqual(runsBelow(profile, 0, 3), [{ start: 4, end: 7 }])
  })
})
