'use strict';

// Run with: node --test tests/filter-engine.test.cjs
// These tests exercise pixel processing with an in-memory Canvas stand-in.
// Browser decoding, resizing, layout and download behavior need browser tests.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'filters.js'), 'utf8'), sandbox);
const engine = sandbox.window.VintageFilters;
const analogGroups = {
  nineties: ['album1991', 'school1994', 'summer1996', 'flash1998', 'minilab1995', 'camcorder1999'],
  vintage: ['expired-roll', 'sunfaded-slide', 'amber-print', 'rose-print', 'silver-print', 'sepia-archive'],
  retro: ['half-frame', 'toy-lens', 'red-leak', 'warm-mist'],
};
const analogIds = Object.values(analogGroups).flat();
const newIds = [
  'ccd2004', 'party-flash', 'keitai2006', 'milk-tea', 'peach-portrait', 'sage-daylight',
  'travel-chrome', 'amber-hour', 'blue-hour', 'neon-diary', 'silver-flash', 'paper-matte',
];
// Keep catalogue/recipe IDs compatible with saved favorites and recipes. The
// historical hashes document the older renderer; deliberate quality upgrades
// are checked by observable image properties below, not frozen old pixels.
const historicalBaseline = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'retained-filter-hashes.json'), 'utf8'));
const retainedIds = Object.keys(historicalBaseline.hashes);

function makeSource(width = 128, height = 64) {
  const source = { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      source.pixels[offset] = x * 2;
      source.pixels[offset + 1] = y * 4;
      source.pixels[offset + 2] = (x + y) * 3 % 256;
      source.pixels[offset + 3] = x % 7 === 0 ? 0 : x % 7 === 1 ? 127 : 255;
    }
  }
  return source;
}

function makeContext(source) {
  return {
    canvas: { width: source.width, height: source.height },
    pixels: new Uint8ClampedArray(source.pixels.length),
    globalAlpha: 0.3,
    globalCompositeOperation: 'multiply',
    filter: 'contrast(2)',
    shadowColor: 'red',
    shadowBlur: 2,
    transform: [2, 0, 0, 2, 20, 20],
    stack: [],
    save() {
      this.stack.push({
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
        filter: this.filter,
        shadowColor: this.shadowColor,
        shadowBlur: this.shadowBlur,
        transform: [...this.transform],
      });
    },
    restore() { Object.assign(this, this.stack.pop()); },
    setTransform(...transform) { this.transform = transform; },
    clearRect() { this.pixels.fill(0); },
    drawImage(image) { this.pixels.set(image.pixels); },
    getImageData() {
      return { data: new Uint8ClampedArray(this.pixels), width: this.canvas.width, height: this.canvas.height };
    },
    putImageData(image) { this.pixels.set(image.data); },
  };
}

function render(source, id, options = {}) {
  const context = makeContext(source);
  engine.render(context, source, id, options);
  return context.pixels;
}

test('catalogue contains original, 32 retained looks and 12 unique new looks', () => {
  const actual = Array.from(engine.presets, (preset) => preset.id);
  const expected = ['original', ...retainedIds, ...newIds];
  assert.equal(actual.length, 45);
  assert.equal(new Set(actual).size, 45);
  assert.deepEqual([...actual].sort(), expected.sort());
  assert.equal(engine.presets[0].id, 'original');
  for (const preset of engine.presets) {
    for (const field of ['id', 'name', 'category', 'description', 'badge']) {
      assert.equal(typeof preset[field], 'string');
      assert.ok(preset[field].length > 0);
    }
    if (newIds.includes(preset.id)) assert.ok(preset.categories.includes('new'), preset.id);
  }
  for (const [category, ids] of Object.entries(analogGroups)) {
    const retainedInCategory = engine.presets.filter((preset) => ids.includes(preset.id));
    assert.deepEqual(Array.from(retainedInCategory, (preset) => preset.id), ids);
    assert.ok(retainedInCategory.every((preset) => preset.category === category), category);
  }
});

test('original and zero strength return source pixels exactly for every preset', () => {
  const source = makeSource();
  assert.deepEqual(render(source, 'original'), source.pixels);
  for (const preset of engine.presets) {
    assert.deepEqual(render(source, preset.id, { strength: 0, texture: 1.5, bloom: 1.5, halation: 1.5, skinProtect: 1 }), source.pixels, preset.id);
  }
});

test('seeded grain is stable, different seeds change grain, and all presets differ', () => {
  const source = makeSource();
  const hashes = new Set();
  for (const preset of engine.presets) {
    const output = render(source, preset.id, { seed: 42 });
    assert.deepEqual(render(source, preset.id, { seed: 42 }), output, preset.id);
    const hash = createHash('sha256').update(output).digest('hex');
    assert.ok(!hashes.has(hash), `Duplicate output: ${preset.id}`);
    hashes.add(hash);
    if (preset.id !== 'original') {
      assert.notDeepEqual(render(source, preset.id, { seed: 43 }), output, preset.id);
    }
  }
});

test('half strength interpolates the filtered RGB channels and retains alpha', () => {
  const source = makeSource();
  for (const preset of engine.presets) {
    const full = render(source, preset.id, { strength: 1, seed: 42 });
    const half = render(source, preset.id, { strength: 0.5, seed: 42 });
    for (let i = 0; i < full.length; i += 1) {
      if (i % 4 === 3) assert.equal(half[i], source.pixels[i]);
      else assert.ok(Math.abs(half[i] - (full[i] + source.pixels[i]) / 2) <= 1, preset.id);
    }
  }
});

test('all filters retain transparent and semitransparent alpha and leave source unchanged', () => {
  const source = makeSource();
  const before = new Uint8ClampedArray(source.pixels);
  for (const preset of engine.presets) {
    const output = render(source, preset.id);
    for (let i = 0; i < output.length; i += 4) {
      assert.equal(output[i + 3], source.pixels[i + 3]);
      if (source.pixels[i + 3] === 0) {
        assert.deepEqual(output.slice(i, i + 4), source.pixels.slice(i, i + 4));
      }
    }
  }
  assert.deepEqual(source.pixels, before);
});

test('monochrome presets produce equal RGB channels at full strength', () => {
  const source = makeSource();
  for (const id of ['silver-mono', 'moon', 'silver-print', 'silver-flash']) {
    const output = render(source, id);
    for (let i = 0; i < output.length; i += 4) {
      if (output[i + 3] === 0) continue;
      assert.equal(output[i], output[i + 1], id);
      assert.equal(output[i + 1], output[i + 2], id);
    }
  }
});

test('destination drawing state is restored after rendering or an image-data error', () => {
  const source = makeSource();
  for (const throwError of [false, true]) {
    const context = makeContext(source);
    if (throwError) context.getImageData = () => { throw new Error('Image data unavailable'); };
    if (throwError) assert.throws(() => engine.render(context, source, 'daily400'), /unavailable/);
    else engine.render(context, source, 'daily400');
    assert.equal(context.globalAlpha, 0.3);
    assert.equal(context.globalCompositeOperation, 'multiply');
    assert.equal(context.filter, 'contrast(2)');
    assert.equal(context.shadowColor, 'red');
    assert.equal(context.shadowBlur, 2);
    assert.deepEqual(context.transform, [2, 0, 0, 2, 20, 20]);
    assert.equal(context.stack.length, 0);
  }
});

test('invalid destinations and preset IDs are rejected and strength is bounded', () => {
  const source = makeSource();
  const context = makeContext(source);
  assert.throws(() => engine.render(null, source, 'daily400'), /context/);
  assert.throws(() => engine.render(context, context.canvas, 'daily400'), /different/);
  assert.throws(() => engine.render(context, source, 'missing'), /Unknown filter/);
  assert.deepEqual(render(source, 'daily400', { strength: -2 }), source.pixels);
  assert.deepEqual(render(source, 'daily400', { strength: 2 }), render(source, 'daily400', { strength: 1 }));
});

test('finishing controls are bounded, default safely, and do not mutate options', () => {
  const source = makeSource(40, 32);
  const defaults = { texture: 1, bloom: 1, halation: 1, skinProtect: 0.6 };
  for (const [key, maximum] of [['texture', 1.5], ['bloom', 1.5], ['halation', 1.5], ['skinProtect', 1]]) {
    assert.deepEqual(render(source, 'neon-diary', { [key]: -3 }), render(source, 'neon-diary', { [key]: 0 }), key);
    assert.deepEqual(render(source, 'neon-diary', { [key]: 9 }), render(source, 'neon-diary', { [key]: maximum }), key);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.deepEqual(render(source, 'neon-diary', { [key]: invalid }), render(source, 'neon-diary', { [key]: defaults[key] }), key);
    }
  }
  const options = Object.freeze({ texture: 0.4, bloom: 0.8, halation: 1.2, skinProtect: 0.9, strength: 0.6, seed: 42 });
  assert.doesNotThrow(() => render(source, 'neon-diary', options));
  assert.equal(options.texture, 0.4);
});

function makeFlatSource(width, height, value = 24) {
  const source = { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  for (let i = 0; i < source.pixels.length; i += 4) {
    source.pixels[i] = source.pixels[i + 1] = source.pixels[i + 2] = value;
    source.pixels[i + 3] = 255;
  }
  return source;
}

function makeColorSource(width, height, color) {
  const source = makeFlatSource(width, height);
  for (let i = 0; i < source.pixels.length; i += 4) source.pixels.set([...color, 255], i);
  return source;
}

function meanRgb(pixels, width, height, inset = 0) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = inset; y < height - inset; y += 1) {
    for (let x = inset; x < width - inset; x += 1) {
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += pixels[i + channel];
      count++;
    }
  }
  return sums.map((sum) => sum / count);
}

const cleanOptions = { texture: 0, bloom: 0, halation: 0, skinProtect: 0 };

test('zero texture removes seed-dependent texture without removing each look', () => {
  const source = makeColorChart();
  for (const preset of engine.presets) {
    const first = render(source, preset.id, { texture: 0, seed: 42 });
    const second = render(source, preset.id, { texture: 0, seed: 918 });
    assert.deepEqual(first, second, preset.id + ' keeps seed-dependent texture at zero');
    if (preset.id !== 'original') assert.notDeepEqual(first, source.pixels, preset.id + ' loses its color treatment');
  }
});

test('texture changes fine variation while leaving flat-field average tone stable', () => {
  const source = makeFlatSource(128, 96, 128);
  for (const id of ['album1991', 'half-frame', 'neon-diary', 'ccd2004', 'clarendon']) {
    const clean = render(source, id, { texture: 0, seed: 42 });
    const textured = render(source, id, { texture: 1.5, seed: 42 });
    assert.notDeepEqual(clean, textured, id + ' texture control has no visible effect');
    const cleanMean = meanRgb(clean, source.width, source.height, 16);
    const texturedMean = meanRgb(textured, source.width, source.height, 16);
    for (let channel = 0; channel < 3; channel += 1) {
      assert.ok(Math.abs(texturedMean[channel] - cleanMean[channel]) < 2,
        id + ' texture should not act as exposure or a color cast');
    }
  }
});

test('grain clusters remain correlated when export resolution changes', () => {
  // Both outputs are large enough to resolve this look's fine grain. Smaller
  // thumbnail renders deliberately attenuate frequencies they cannot resolve.
  const width = 640, height = 480, scale = 3;
  const lowSource = makeFlatSource(width, height, 128);
  const highSource = makeFlatSource(width * scale, height * scale, 128);
  const options = { bloom: 0, halation: 0, skinProtect: 0, seed: 42 };
  const lowClean = render(lowSource, 'half-frame', { ...options, texture: 0 });
  const highClean = render(highSource, 'half-frame', { ...options, texture: 0 });
  const lowTextured = render(lowSource, 'half-frame', { ...options, texture: 1 });
  const highTextured = render(highSource, 'half-frame', { ...options, texture: 1 });
  let sumLow = 0, sumHigh = 0, sumLow2 = 0, sumHigh2 = 0, sumProduct = 0, absoluteError = 0, count = 0;
  // A 3x image has corresponding pixel centers at (3x+1, 3y+1). Subtracting
  // texture-free results isolates grain from tone and vignette. Final 8-bit
  // rounding, sub-LSB dithering and sparse dust can still differ slightly.
  for (let y = 8; y < height - 8; y += 1) {
    for (let x = 8; x < width - 8; x += 1) {
      const at = (y * width + x) * 4;
      const low = lowTextured[at] - lowClean[at];
      const i = ((y * scale + 1) * width * scale + x * scale + 1) * 4;
      const high = highTextured[i] - highClean[i];
      sumLow += low; sumHigh += high;
      sumLow2 += low * low; sumHigh2 += high * high; sumProduct += low * high;
      absoluteError += Math.abs(low - high);
      count++;
    }
  }
  const covariance = sumProduct - sumLow * sumHigh / count;
  const varianceLow = sumLow2 - sumLow * sumLow / count;
  const varianceHigh = sumHigh2 - sumHigh * sumHigh / count;
  const correlation = covariance / Math.sqrt(varianceLow * varianceHigh);
  assert.ok(correlation > 0.9,
    'Frame-space grain should retain the same clusters across output sizes; correlation=' + correlation.toFixed(3));
  assert.ok(absoluteError / count < 1.5,
    'Texture residuals should stay close across resolutions; average error=' + (absoluteError / count).toFixed(3));
});

test('halation leaves a uniformly bright surface unchanged and warms light boundaries', () => {
  for (const value of [180, 220, 245]) {
    const flat = makeFlatSource(96, 64, value);
    const clean = render(flat, 'neon-diary', cleanOptions);
    const halo = render(flat, 'neon-diary', { ...cleanOptions, halation: 1.5 });
    for (let i = 0; i < halo.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        assert.ok(Math.abs(halo[i + channel] - clean[i + channel]) <= 1,
          'Uniform light should not be treated as a luminous edge');
      }
    }
  }
  const source = makeFlatSource(256, 128, 20);
  for (let y = 48; y < 80; y += 1) {
    for (let x = 112; x < 144; x += 1) source.pixels.set([250, 250, 250, 255], (y * source.width + x) * 4);
  }
  const clean = render(source, 'neon-diary', cleanOptions);
  const halo = render(source, 'neon-diary', { ...cleanOptions, halation: 1.5 });
  const lift = [0, 0, 0];
  let affected = 0;
  for (let y = 40; y < 88; y += 1) {
    for (let x = 104; x < 152; x += 1) {
      if (x >= 112 && x < 144 && y >= 48 && y < 80) continue;
      const i = (y * source.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) lift[channel] += halo[i + channel] - clean[i + channel];
      if (halo[i] > clean[i]) affected++;
    }
  }
  assert.ok(affected > 16, 'Halation must extend outside the light source');
  assert.ok(lift[0] > lift[1] && lift[0] > lift[2] && lift[0] > 0, 'Halation should have a warm boundary');
  assert.deepEqual(Array.from(halo.slice(0, 4)), Array.from(clean.slice(0, 4)), 'Distant shadows must remain unaffected');
});

test('bloom can be removed independently of the filter color and halation', () => {
  const source = makeFlatSource(256, 128, 30);
  for (let y = 48; y < 80; y += 1) {
    for (let x = 112; x < 144; x += 1) source.pixels.set([250, 250, 250, 255], (y * source.width + x) * 4);
  }
  const clean = render(source, 'warm-mist', cleanOptions);
  const bloom = render(source, 'warm-mist', { ...cleanOptions, bloom: 1.5 });
  let neighboringLift = 0;
  for (let y = 40; y < 88; y += 1) {
    for (let x = 104; x < 152; x += 1) {
      if (x >= 112 && x < 144 && y >= 48 && y < 80) continue;
      const i = (y * source.width + x) * 4;
      neighboringLift += bloom[i] + bloom[i + 1] + bloom[i + 2] - clean[i] - clean[i + 1] - clean[i + 2];
    }
  }
  assert.ok(neighboringLift > 0, 'Bloom control must alter light spread outside the source');
  assert.notDeepEqual(clean, source.pixels, 'Removing light spread must retain the preset color');
  assert.deepEqual(Array.from(bloom.slice(0, 4)), Array.from(clean.slice(0, 4)), 'Bloom should not wash distant dark areas');
});

test('own looks retain ordered, distinct bright gray steps without a white plateau', () => {
  const legacy = new Set(['clarendon', 'gingham', 'lark', 'moon']);
  for (const preset of engine.presets) {
    if (preset.id === 'original' || legacy.has(preset.id)) continue;
    const values = [180, 196, 212, 228, 244].map((level) => {
      const source = makeFlatSource(24, 24, level);
      const rgb = meanRgb(render(source, preset.id, cleanOptions), 24, 24, 8);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    });
    for (let i = 1; i < values.length; i += 1) {
      assert.ok(values[i] > values[i - 1] + 0.5,
        preset.id + ' loses neighboring bright steps: ' + values.map((value) => value.toFixed(2)).join(', '));
    }
  }
});

test('vivid color patches keep channel detail instead of hitting hard gamut walls', () => {
  const colors = [[238, 54, 36], [42, 221, 68], [35, 84, 240], [230, 38, 173], [234, 213, 38], [28, 205, 230]];
  for (const id of ['travel-chrome', 'ccd2004', 'peach-portrait', 'sage-daylight']) {
    let clipped = 0;
    let channels = 0;
    for (const color of colors) {
      const output = render(makeColorSource(32, 32, color), id, cleanOptions);
      for (let y = 8; y < 24; y += 1) {
        for (let x = 8; x < 24; x += 1) {
          const offset = (y * 32 + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            if (output[offset + channel] === 0 || output[offset + channel] === 255) clipped++;
            channels++;
          }
        }
      }
    }
    assert.ok(clipped / channels < 0.01,
      id + ' hard-clips ' + (clipped / channels * 100).toFixed(1) + '% of vivid patch channels');
  }
});

function chromaticityError(rgb, reference) {
  const sum = rgb.reduce((a, b) => a + b, 0) || 1;
  const targetSum = reference.reduce((a, b) => a + b, 0) || 1;
  return rgb.reduce((error, value, i) => error + (value / sum - reference[i] / targetSum) ** 2, 0);
}

test('skin protection reduces warm-color distortion while keeping the look contrast', () => {
  // Warm color patches span light and darker skin-like colors; this asserts
  // color behavior only and does not assume person/skin recognition.
  const colors = [[208, 149, 112], [155, 101, 71], [102, 67, 47]];
  for (const id of ['blue-hour', 'sage-daylight', 'neon-diary', 'travel-chrome']) {
    let unprotectedError = 0;
    let protectedError = 0;
    let remainingToneChange = 0;
    for (const color of colors) {
      const source = makeColorSource(64, 64, color);
      const before = meanRgb(render(source, id, cleanOptions), 64, 64, 20);
      const after = meanRgb(render(source, id, { ...cleanOptions, skinProtect: 1 }), 64, 64, 20);
      unprotectedError += chromaticityError(before, color);
      protectedError += chromaticityError(after, color);
      remainingToneChange += Math.abs(after.reduce((a, b) => a + b, 0) - color.reduce((a, b) => a + b, 0));
    }
    assert.ok(protectedError < unprotectedError * 0.9,
      id + ' should preserve warm-color balance: ' + protectedError + ' vs ' + unprotectedError);
    assert.ok(remainingToneChange > 3, id + ' protection must not replace the look with the original');
  }
  const source = makeColorSource(32, 32, colors[0]);
  for (const id of ['silver-mono', 'moon', 'silver-print', 'silver-flash']) {
    const output = render(source, id, { skinProtect: 1 });
    for (let i = 0; i < output.length; i += 4) {
      assert.equal(output[i], output[i + 1], id + ' protection tinted a monochrome look');
      assert.equal(output[i + 1], output[i + 2], id + ' protection tinted a monochrome look');
    }
  }
});

test('pocket digicam color noise is stronger in shadows than in bright areas', () => {
  function colorVariation(value) {
    // Mid-dark and mid-bright neutral patches avoid black/white clipping.
    const source = makeFlatSource(128, 96, value);
    const first = render(source, 'ccd2004', { seed: 42 });
    const second = render(source, 'ccd2004', { seed: 918 });
    let variation = 0;
    for (let i = 0; i < first.length; i += 4) {
      // Channel differences cancel common luminance grain; seed differences
      // cancel the fixed tone curve, tint, diffusion and vignette treatment.
      variation += Math.abs((first[i] - first[i + 1]) - (second[i] - second[i + 1]));
      variation += Math.abs((first[i + 2] - first[i + 1]) - (second[i + 2] - second[i + 1]));
    }
    return variation / (source.width * source.height * 2);
  }
  const shadows = colorVariation(64);
  const highlights = colorVariation(192);
  assert.ok(shadows > highlights * 2,
    `Shadow color variation (${shadows.toFixed(3)}) must clearly exceed bright-area variation (${highlights.toFixed(3)})`);
});

test('warm-mist diffuses a bright light into neighboring pixels', () => {
  const dark = makeFlatSource(256, 128);
  const bright = makeFlatSource(256, 128);
  for (let y = 48; y < 80; y += 1) {
    for (let x = 112; x < 144; x += 1) {
      const offset = (y * bright.width + x) * 4;
      bright.pixels[offset] = bright.pixels[offset + 1] = bright.pixels[offset + 2] = 255;
    }
  }
  const baseline = render(dark, 'warm-mist', { seed: 42 });
  const result = render(bright, 'warm-mist', { seed: 42 });
  let neighboringLift = 0;
  let affectedPixels = 0;
  for (let y = 40; y < 88; y += 1) {
    for (let x = 104; x < 152; x += 1) {
      if (x >= 112 && x < 144 && y >= 48 && y < 80) continue;
      const offset = (y * bright.width + x) * 4;
      const lift = result[offset] + result[offset + 1] + result[offset + 2]
        - baseline[offset] - baseline[offset + 1] - baseline[offset + 2];
      neighboringLift += lift;
      if (lift > 0) affectedPixels += 1;
    }
  }
  assert.ok(neighboringLift > 0, 'A light source must brighten its surroundings, not just change its own color');
  assert.ok(affectedPixels > 16, 'Diffusion should reach multiple neighboring pixels');
});

test('hidden RGB in transparent pixels cannot contaminate neighboring analog effects', () => {
  const blackHole = makeFlatSource(96, 64, 90);
  const brightHole = makeFlatSource(96, 64, 90);
  for (let y = 22; y < 42; y += 1) {
    for (let x = 36; x < 60; x += 1) {
      const offset = (y * blackHole.width + x) * 4;
      blackHole.pixels.set([0, 0, 0, 0], offset);
      brightHole.pixels.set([255, 0, 255, 0], offset);
    }
  }
  for (const id of [...analogIds, ...newIds]) {
    const dark = render(blackHole, id, { seed: 73 });
    const bright = render(brightHole, id, { seed: 73 });
    for (let i = 0; i < dark.length; i += 4) {
      if (blackHole.pixels[i + 3] === 0) continue;
      assert.equal(bright[i], dark[i], id + ': red contamination');
      assert.equal(bright[i + 1], dark[i + 1], id + ': green contamination');
      assert.equal(bright[i + 2], dark[i + 2], id + ': blue contamination');
    }
  }
});

test('spatial filters handle one-pixel axes and portrait or landscape images', () => {
  for (const [width, height] of [[1, 1], [1, 79], [83, 1], [17, 31], [80, 47]]) {
    const source = makeSource(width, height);
    // Keep the narrowest source visible so it exercises the effects pipeline.
    for (let i = 3; i < source.pixels.length; i += 4) source.pixels[i] = 255;
    for (const id of [...analogIds, ...newIds]) {
      const output = render(source, id, { strength: 0.8, seed: 17 });
      assert.equal(output.length, width * height * 4, id);
      for (let i = 3; i < output.length; i += 4) assert.equal(output[i], 255, id);
      assert.deepEqual(render(source, id, { strength: 0 }), source.pixels, id);
    }
  }
});

// Averaged color patches separate a changed color treatment from grain-only variants.
function makeColorChart() {
  const colors = [[240, 180, 140], [210, 70, 55], [55, 145, 75], [50, 135, 180],
    [75, 80, 185], [180, 95, 155], [230, 205, 100], [160, 160, 160]];
  const source = makeFlatSource(128, 64);
  for (let y = 0; y < source.height; y += 1) {
    const brightness = [0.35, 0.65, 1, 1.25][Math.floor(y / 16)];
    for (let x = 0; x < source.width; x += 1) {
      const color = colors[Math.floor(x / 16)];
      const offset = (y * source.width + x) * 4;
      for (let c = 0; c < 3; c += 1) source.pixels[offset + c] = Math.min(255, color[c] * brightness);
    }
  }
  return source;
}
function colorSignature(pixels, width) {
  const signature = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const sums = [0, 0, 0];
      for (let y = row * 16 + 3; y < row * 16 + 13; y += 1) {
        for (let x = column * 16 + 3; x < column * 16 + 13; x += 1) {
          const offset = (y * width + x) * 4;
          for (let c = 0; c < 3; c += 1) sums[c] += pixels[offset + c];
        }
      }
      signature.push(...sums.map((sum) => sum / 100));
    }
  }
  return signature;
}

test('new looks have distinct averaged color treatments, rather than grain-only duplicates', () => {
  const source = makeColorChart();
  const signatures = new Map(engine.presets.map((preset) => [preset.id, colorSignature(render(source, preset.id, {seed: 42}), source.width)]));
  for (const id of newIds) {
    const signature = signatures.get(id);
    for (const [otherId, other] of signatures) {
      if (otherId === id) continue;
      const difference = signature.reduce((sum, value, i) => sum + Math.abs(value - other[i]), 0) / signature.length;
      assert.ok(difference > 1.5, id + ' too close to ' + otherId + ': mean color difference ' + difference.toFixed(2));
    }
  }
});
