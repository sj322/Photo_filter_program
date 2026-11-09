'use strict';

// Pixel and geometry tests use a small nearest-neighbor Canvas stand-in.
// Browser interpolation, image decoding and UI behavior need separate checks.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

class MemoryCanvas {
  constructor(width = 1, height = 1) {
    this._width = width;
    this._height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  get width() { return this._width; }
  set width(value) { this._width = value; this.pixels = new Uint8ClampedArray(value * this.height * 4); }
  get height() { return this._height; }
  set height(value) { this._height = value; this.pixels = new Uint8ClampedArray(this.width * value * 4); }
  getContext() {
    if (this.context) return this.context;
    this.context = {
      canvas: this, matrix: [1, 0, 0, 1, 0, 0], stack: [],
      globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', shadowColor: 'transparent', shadowBlur: 0,
      save() { this.stack.push({ matrix: this.matrix.slice(), globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation, filter: this.filter,
        shadowColor: this.shadowColor, shadowBlur: this.shadowBlur }); },
      restore() { Object.assign(this, this.stack.pop()); },
      setTransform(...values) { this.matrix = values; },
      multiply(n) {
        const [a, b, c, d, e, f] = this.matrix;
        this.matrix = [a * n[0] + c * n[1], b * n[0] + d * n[1],
          a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f];
      },
      translate(x, y) { this.multiply([1, 0, 0, 1, x, y]); },
      scale(x, y) { this.multiply([x, 0, 0, y, 0, 0]); },
      rotate(angle) { this.multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]); },
      clearRect() { this.canvas.pixels.fill(0); },
      drawImage(source, dx, dy, dw = source.width, dh = source.height) {
        const [a, b, c, d, e, f] = this.matrix;
        const determinant = a * d - b * c;
        for (let y = 0; y < this.canvas.height; y += 1) {
          for (let x = 0; x < this.canvas.width; x += 1) {
            const px = x + 0.5 - e;
            const py = y + 0.5 - f;
            const localX = (d * px - c * py) / determinant;
            const localY = (-b * px + a * py) / determinant;
            const sx = Math.floor((localX - dx) / dw * source.width + 1e-8);
            const sy = Math.floor((localY - dy) / dh * source.height + 1e-8);
            if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
            const sourceOffset = (sy * source.width + sx) * 4;
            this.canvas.pixels.set(source.pixels.subarray(sourceOffset, sourceOffset + 4), (y * this.canvas.width + x) * 4);
          }
        }
      },
      getImageData() { return { width: this.canvas.width, height: this.canvas.height, data: this.canvas.pixels.slice() }; },
      putImageData(image) { this.canvas.pixels.set(image.data); },
    };
    return this.context;
  }
}

const scope = { window: { document: { createElement(tag) { assert.equal(tag, 'canvas'); return new MemoryCanvas(); } } } };
for (const file of ['filters.js', 'editor-core.js']) {
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', file), 'utf8'), scope, { filename: file });
}
const core = scope.window.VintageEditorCore;
const filters = scope.window.VintageFilters;
const plain = (value) => JSON.parse(JSON.stringify(value));
const pixels = (values, width = values.length / 4) => ({ data: Uint8ClampedArray.from(values), width, height: values.length / 4 / width });

function source(width = 24, height = 16) {
  const canvas = new MemoryCanvas(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      canvas.pixels.set([(x * 11) % 256, (y * 17) % 256, ((x + y) * 9) % 256, x % 7 ? 255 : 96], (y * width + x) * 4);
    }
  }
  return canvas;
}

test('manual edit settings normalize safely and never mutate their input', () => {
  assert.deepEqual(plain(core.normalizeEdits()), plain(core.defaults));
  assert.ok(Object.isFrozen(core.defaults));
  const input = { exposure: 250, contrast: -200, temperature: Infinity, saturation: '24', fade: -5,
    grain: 180, vignette: NaN, highlights: -150, shadows: '45', texture: 500,
    bloom: -10, halation: Infinity, skinProtect: 150, rotate: -90, aspect: 'wrong' };
  const normalized = core.normalizeEdits(input);
  assert.deepEqual(plain(normalized), { exposure: 100, contrast: -100, highlights: -100, shadows: 45,
    temperature: 0, saturation: 24, fade: 0, grain: 100, vignette: 0, texture: 150,
    bloom: 0, halation: 100, skinProtect: 100, rotate: 270, aspect: 'original' });
  assert.equal(input.exposure, 250);
  assert.equal(core.normalizeEdits({ rotate: 450 }).rotate, 90);
  assert.equal(core.normalizeEdits(null).aspect, 'original');
});

test('neutral edits preserve exact RGBA and return the original ImageData object', () => {
  const image = pixels([128, 34, 240, 255, 12, 200, 70, 0, 74, 90, 120, 128]);
  const before = image.data.slice();
  assert.equal(core.adjustPixels(image, core.defaults), image);
  assert.deepEqual(image.data, before);
});

test('exposure, temperature, desaturation and fade move pixels in their intended directions', () => {
  const bright = pixels([128, 128, 128, 255]);
  const dark = pixels([128, 128, 128, 255]);
  core.adjustPixels(bright, { exposure: 100 });
  core.adjustPixels(dark, { exposure: -100 });
  assert.ok(bright.data[0] >= 174 && bright.data[0] <= 176, '+1 stop in linear sRGB');
  assert.ok(dark.data[0] >= 91 && dark.data[0] <= 93, '-1 stop in linear sRGB');
  const warm = pixels([128, 128, 128, 255]);
  core.adjustPixels(warm, { temperature: 80 });
  assert.ok(warm.data[0] > warm.data[1] && warm.data[1] > warm.data[2]);
  const gray = pixels([190, 60, 120, 255]);
  core.adjustPixels(gray, { saturation: -100 });
  assert.equal(gray.data[0], gray.data[1]);
  assert.equal(gray.data[1], gray.data[2]);
  const faded = pixels([0, 0, 0, 255, 255, 255, 255, 255]);
  core.adjustPixels(faded, { fade: 100 });
  assert.ok(faded.data[0] > 0 && faded.data[4] < 255);
});

test('extreme controls preserve alpha, hidden RGB and valid channel values', () => {
  const image = pixels([0, 255, 120, 0, 20, 80, 240, 128, 255, 240, 0, 255]);
  const hidden = image.data.slice(0, 4);
  core.adjustPixels(image, { exposure: 100, contrast: 100, highlights: 100, shadows: -100, temperature: -100, saturation: 100,
    fade: 100, grain: 100, vignette: 100 }, { seed: 42 });
  assert.deepEqual(image.data.slice(0, 4), hidden);
  assert.equal(image.data[7], 128);
  assert.equal(image.data[11], 255);
  assert.ok([...image.data].every((value) => Number.isFinite(value) && value >= 0 && value <= 255));
});

test('positive exposure and contrast retain ordered highlight detail instead of clipping it to white', () => {
  const steps = [128, 160, 188, 200, 216, 232, 248, 255];
  for (const edits of [{ exposure: 100 }, { contrast: 100 }, { exposure: 80, contrast: 35 }]) {
    const image = pixels(steps.flatMap((value) => [value, value, value, 255]));
    core.adjustPixels(image, edits);
    const result = steps.map((_, i) => image.data[i * 4]);
    assert.ok(result[0] >= 128, 'midtone exposure remains useful');
    for (let i = 1; i < result.length; i += 1) assert.ok(result[i] > result[i - 1], 'each original highlight step stays distinct');
    assert.ok(result.at(-1) < 255, 'there is no hard white plateau');
    for (let i = 0; i < result.length; i += 1) {
      assert.equal(image.data[i * 4], image.data[i * 4 + 1]);
      assert.equal(image.data[i * 4 + 1], image.data[i * 4 + 2]);
    }
  }
});

test('highlights and shadows target their luminance zones without changing the opposite end', () => {
  const values = [32, 96, 160, 224];
  const make = () => pixels(values.flatMap((value) => [value, value, value, 255]));
  const lowerHighlights = make(); core.adjustPixels(lowerHighlights, { highlights: -65 });
  const liftShadows = make(); core.adjustPixels(liftShadows, { shadows: 65 });
  assert.equal(lowerHighlights.data[0], 32);
  assert.ok(224 - lowerHighlights.data[12] > 96 - lowerHighlights.data[4]);
  assert.equal(liftShadows.data[12], 224);
  assert.ok(liftShadows.data[0] > 32);
  assert.ok(liftShadows.data[0] - 32 > liftShadows.data[8] - 160);
  const sourcePixels = make();
  const sourceCopy = sourcePixels.data.slice();
  core.adjustPixels(sourcePixels, { texture: 0, bloom: 150, halation: 150, skinProtect: 100 });
  assert.deepEqual(sourcePixels.data, sourceCopy, 'film controls are applied only in the film renderer');
});

test('gamut compression preserves the direction of saturated color instead of clipping individual channels', () => {
  const value = [220, 60, 80];
  const image = pixels([...value, 255]);
  core.adjustPixels(image, { saturation: 100 });
  const light = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const beforeLight = light(value), afterLight = light(image.data);
  const before = value.map((channel) => channel - beforeLight);
  const after = Array.from(image.data.slice(0, 3), (channel) => channel - afterLight);
  const dot = before.reduce((sum, value, index) => sum + value * after[index], 0);
  const cosine = dot / (Math.hypot(...before) * Math.hypot(...after));
  assert.ok(cosine > 0.99995, 'neutral-axis hue direction survives gamut fitting within 8-bit rounding');
  assert.ok(image.data[0] < 255 && image.data[1] > 0 && image.data[2] > 0);
});

test('grain is stable by seed and vignette darkens edges while preserving the center', () => {
  const make = () => pixels(Array.from({ length: 25 * 4 }, (_, index) => index % 4 === 3 ? 255 : 128), 5);
  const first = make();
  const same = make();
  const different = make();
  core.adjustPixels(first, { grain: 100 }, { seed: 42 });
  core.adjustPixels(same, { grain: 100 }, { seed: 42 });
  core.adjustPixels(different, { grain: 100 }, { seed: 43 });
  assert.deepEqual(first.data, same.data);
  assert.notDeepEqual(first.data, different.data);
  const vignette = make();
  core.adjustPixels(vignette, { vignette: 100 });
  assert.equal(vignette.data[12 * 4], 128);
  assert.ok(vignette.data[0] < vignette.data[12 * 4]);
  assert.equal(vignette.data[0], vignette.data[24 * 4]);
});

test('added grain uses the same frame coordinates at preview and export sizes', () => {
  const make = (width) => pixels(Array.from({ length: width * width * 4 }, (_, index) => index % 4 === 3 ? 255 : 128), width);
  const preview = make(20), large = make(60);
  core.adjustPixels(preview, { grain: 100 }, { seed: 72 });
  core.adjustPixels(large, { grain: 100 }, { seed: 72 });
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      assert.equal(preview.data[(y * 20 + x) * 4], large.data[((y * 3 + 1) * 60 + x * 3 + 1) * 4]);
    }
  }
});

test('rotation, centered crop, export limits and thin dimensions remain bounded', () => {
  const landscape = { width: 4000, height: 3000 };
  const original = core.orientedSize(landscape);
  assert.equal(original.width, 1440);
  assert.equal(original.height, 1080);
  const portrait = core.orientedSize(landscape, { rotate: 90 });
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.height, 1440);
  const square = core.orientedSize(landscape, { aspect: '1:1' });
  assert.equal(square.cropX, 500);
  assert.equal(square.width, 1440);
  assert.equal(square.height, 1440);
  const social = core.orientedSize(landscape, { rotate: 90, aspect: '4:5' });
  assert.equal(social.width, 1152);
  assert.equal(social.height, 1440);
  assert.equal(core.orientedSize({ width: 100, height: 80 }, {}, 4096).width, 100);
  assert.equal(core.orientedSize({ width: 8000, height: 6000 }, {}, Infinity).width, 4096);
  for (const dimensions of [{ width: 1, height: 4000 }, { width: 4000, height: 1 }]) {
    for (const aspect of ['original', '1:1', '4:5', '3:2', '9:16']) {
      const size = core.orientedSize(dimensions, { aspect, rotate: 90 });
      assert.ok(size.width >= 1 && size.height >= 1 && Math.max(size.width, size.height) <= 1440);
    }
  }
  assert.throws(() => core.orientedSize({ width: 0, height: 1 }), /non-empty/);
});

test('render rotates clockwise and crops the center without touching the source', () => {
  const image = new MemoryCanvas(2, 3);
  for (let i = 0; i < 6; i += 1) image.pixels.set([10 + i, 30, 40, 255], i * 4);
  const before = image.pixels.slice();
  const rotated = core.render(image, { edits: { rotate: 90 } });
  assert.equal(rotated.width, 3);
  assert.equal(rotated.height, 2);
  assert.deepEqual(Array.from(rotated.pixels).filter((_, i) => i % 4 === 0), [14, 12, 10, 15, 13, 11]);
  assert.deepEqual(image.pixels, before);
  const wide = new MemoryCanvas(4, 2);
  for (let i = 0; i < 8; i += 1) wide.pixels.set([10 + i, 30, 40, 255], i * 4);
  const cropped = core.render(wide, { edits: { aspect: '1:1' } });
  assert.deepEqual(Array.from(cropped.pixels).filter((_, i) => i % 4 === 0), [11, 12, 15, 16]);
});

test('before/after comparison keeps geometry and bypasses every color and texture edit', () => {
  const image = source();
  const original = image.pixels.slice();
  const edits = { rotate: 90, aspect: '4:5', exposure: 50, temperature: 30, highlights: -70, shadows: 35,
    texture: 120, bloom: 125, halation: 135, skinProtect: 85, grain: 20, vignette: 20 };
  const expected = core.render(image, { edits: { rotate: 90, aspect: '4:5' } });
  const comparison = core.render(image, { filter: 'gold200', strength: 100, edits, compare: true });
  const edited = core.render(image, { filter: 'gold200', strength: 80, edits });
  assert.deepEqual(comparison.pixels, expected.pixels);
  assert.equal(edited.width, comparison.width);
  assert.equal(edited.height, comparison.height);
  assert.notDeepEqual(edited.pixels, comparison.pixels);
  assert.deepEqual(image.pixels, original);
  const repeated = core.render(image, { filter: 'gold200', strength: 80, edits });
  assert.deepEqual(edited.pixels, repeated.pixels);
  assert.throws(() => core.render(image, { filter: 'missing' }), /Unknown filter/);
});

test('render passes normalized film controls to the same filter renderer used by preview and export', () => {
  const calls = [];
  const saved = scope.window.VintageFilters;
  scope.window.VintageFilters = { presets: saved.presets, render(context, input, id, options) {
    calls.push({ id, ...plain(options) });
    context.drawImage(input, 0, 0);
  } };
  try {
    const image = source();
    const edits = { texture: 0, bloom: 150, halation: 85, skinProtect: 73, highlights: -20, shadows: 15 };
    core.render(image, { filter: 'milk-tea', strength: 66, edits, maxDimension: 1440 });
    core.render(image, { filter: 'milk-tea', strength: 66, edits, maxDimension: 4096 });
    assert.deepEqual(calls[0], { id: 'milk-tea', strength: 0.66, seed: 42, texture: 0, bloom: 1.5, halation: 0.85, skinProtect: 0.73 });
    assert.deepEqual(calls[1], calls[0]);
  } finally { scope.window.VintageFilters = saved; }
});

test('zero filter strength still applies manual corrections and original is non-destructive', () => {
  const image = source();
  const original = image.pixels.slice();
  const exact = core.render(image);
  assert.notEqual(exact, image);
  assert.deepEqual(exact.pixels, original);
  const manual = core.render(image, { edits: { exposure: 30 } });
  const zeroPreset = core.render(image, { filter: 'warm-mist', strength: 0, edits: { exposure: 30 } });
  assert.deepEqual(manual.pixels, zeroPreset.pixels);
  assert.notDeepEqual(manual.pixels, original);
  assert.deepEqual(image.pixels, original);
});

test('recommendations are six unique valid IDs, deterministic and sensitive to photo brightness', () => {
  const dark = new MemoryCanvas(12, 12);
  const bright = new MemoryCanvas(12, 12);
  for (let i = 0; i < dark.pixels.length; i += 4) {
    dark.pixels.set([20, 20, 20, 255], i);
    bright.pixels.set([230, 220, 210, 255], i);
  }
  const darkIds = Array.from(core.recommend(dark));
  const brightIds = Array.from(core.recommend(bright));
  assert.equal(darkIds.length, 6);
  assert.equal(new Set(darkIds).size, 6);
  assert.ok(darkIds.every((id) => id !== 'original' && filters.presets.some((preset) => preset.id === id)));
  assert.deepEqual(Array.from(core.recommend(dark)), darkIds);
  assert.notDeepEqual(brightIds, darkIds);
  assert.ok(darkIds.includes('neon-diary'), 'night photos include the new neon look');
  assert.ok(brightIds.includes('peach-portrait'), 'bright photos include the new soft portrait look');
  assert.ok(darkIds.some((id) => !filters.presets.find((preset) => preset.id === id).categories?.includes('new')), 'retained looks remain discoverable');
});
