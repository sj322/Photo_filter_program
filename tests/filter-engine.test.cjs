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

test('catalogue contains original, sixteen new analog looks and sixteen retained presets', () => {
  const expected = [
    'original', ...analogIds, 'daily400', 'gold200', 'green400', 'classic-negative', 'soft-pastel',
    'cinema800', 'cool-digicam', 'warm-digicam', 'disposable', 'instant', 'faded-brown',
    'silver-mono', 'clarendon', 'gingham', 'lark', 'moon',
  ];
  assert.deepEqual(Array.from(engine.presets, (preset) => preset.id), expected);
  assert.equal(new Set(expected).size, 33);
  for (const preset of engine.presets) {
    for (const field of ['id', 'name', 'category', 'description', 'badge']) {
      assert.equal(typeof preset[field], 'string');
      assert.ok(preset[field].length > 0);
    }
  }
  for (const [category, ids] of Object.entries(analogGroups)) {
    assert.deepEqual(Array.from(engine.presets.filter((preset) => preset.category === category), (preset) => preset.id), ids);
  }
});

test('all sixteen retained looks keep their pre-expansion pixel results', () => {
  // Captured before adding the analog pipeline, with this fixture and seed 42.
  const expected = {
    daily400: 'e23194d5b481ace327d54db86604e6ec7888e5fb1b5ece690cdb66c782273a7b',
    gold200: '8df93765fe17a97d73f1f6f449a3a98e3eceaf9797e57030e32e41d46da678c0',
    green400: '4437ffb701b57986ba9a6a15b3d969a5c6d45b1dfcb47a384c5bd19b8b78410c',
    'classic-negative': '151777d48b9a739f643fab0d89a482d254120623d0970ad75cadd29b58a7cffa',
    'soft-pastel': 'd463cd6ff7e5eb693ec7b2dedb996f01b6cb735c6367c9ebef063fe2392d4c3d',
    cinema800: '76d2a25fbe11b1e2b76f87cfa916fbe9501241b9907286a9ed4d40b8d7ba4a10',
    'cool-digicam': 'd34e1c59759a533eaa4465d2ec4a980ca03d3fb9b7e36b6e422e7ba472d91877',
    'warm-digicam': '9ea27af1064e0bd4ab89b76db0f2668f1ac0b4fca1bbcd2c1d05fd195c6c786e',
    disposable: '298f04480c1c7c40fb8dd791ccb982a71fc53bce393eed2fa8f5a0ca31c59852',
    instant: '5207c5f0d30d51f61907463e704fdcae542b13e0549ff3925da16562cae2db50',
    'faded-brown': 'd3a375b2b35be5a7c8ba63e616c2abdc190fa97ae6d7a3db8c13bb8bc11bafa2',
    'silver-mono': '981f051d534d4e25faefe8751f2e492ae31c697ee0f909ae556fd990e9fb03f9',
    clarendon: '3c7d0d0dfd077c0d6f4670bb6d02809929080eaf14c9adcf39c9753a0af21612',
    gingham: 'cdc7a3c1bd856637e83154eade41770279aebde9b1b12de857a2caf99e501d6d',
    lark: '567659e951ee8124aa1db998eccd24c702822d14c24016a4e7a7ca28469c108b',
    moon: 'acf15dfae6a92a0c0be86179e6177e7681b523a74e11b2e8d3204f669573b5fa',
  };
  const source = makeSource();
  for (const [id, hash] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(render(source, id, { seed: 42 })).digest('hex'), hash, id);
  }
});

test('original and zero strength return source pixels exactly for every preset', () => {
  const source = makeSource();
  assert.deepEqual(render(source, 'original'), source.pixels);
  for (const preset of engine.presets) {
    assert.deepEqual(render(source, preset.id, { strength: 0 }), source.pixels, preset.id);
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
  for (const id of ['silver-mono', 'moon', 'silver-print']) {
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

function makeFlatSource(width, height, value = 24) {
  const source = { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  for (let i = 0; i < source.pixels.length; i += 4) {
    source.pixels[i] = source.pixels[i + 1] = source.pixels[i + 2] = value;
    source.pixels[i + 3] = 255;
  }
  return source;
}

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
  for (const id of analogIds) {
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
    for (const id of analogIds) {
      const output = render(source, id, { strength: 0.8, seed: 17 });
      assert.equal(output.length, width * height * 4, id);
      for (let i = 3; i < output.length; i += 4) assert.equal(output[i], 255, id);
      assert.deepEqual(render(source, id, { strength: 0 }), source.pixels, id);
    }
  }
});
