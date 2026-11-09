'use strict';

// Exercises the actual UI pixel-cache function, with in-memory canvases.
// This does not test browser decoding, resize interpolation, layout or downloads.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const filterScope = { window: {} };
vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'filters.js'), 'utf8'), filterScope);
const engine = filterScope.window.VintageFilters;
const uiSource = readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const functionStart = uiSource.indexOf('function paintSelectedImage(');
const functionEnd = uiSource.indexOf('\nfunction generateThumbnails(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'UI paint function must be available');
const paintSource = uiSource.slice(functionStart, functionEnd);

class MemoryCanvas {
  constructor(width = 0, height = 0) {
    this._width = width;
    this._height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  get width() { return this._width; }
  set width(value) {
    this._width = value;
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
  }
  get height() { return this._height; }
  set height(value) {
    this._height = value;
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
  }
  getContext() {
    if (!this.context) {
      this.context = {
        canvas: this, globalAlpha: 1, globalCompositeOperation: 'source-over',
        filter: 'none', shadowColor: 'transparent', shadowBlur: 0, stack: [],
        save() {
          this.stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
            filter: this.filter, shadowColor: this.shadowColor, shadowBlur: this.shadowBlur });
        },
        restore() { Object.assign(this, this.stack.pop()); },
        setTransform() {},
        clearRect() { this.canvas.pixels.fill(0); },
        drawImage(source) {
          assert.equal(this.canvas.width, source.width, 'This test does not emulate resampling');
          assert.equal(this.canvas.height, source.height, 'This test does not emulate resampling');
          this.canvas.pixels.set(source.pixels);
        },
        getImageData() {
          return { data: new Uint8ClampedArray(this.canvas.pixels), width: this.canvas.width, height: this.canvas.height };
        },
        createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4), width, height }; },
        putImageData(image) { this.canvas.pixels.set(image.data); },
      };
    }
    return this.context;
  }
}

function sourceCanvas(width = 40, height = 24, offset = 0) {
  const canvas = new MemoryCanvas(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      canvas.pixels.set([(x * 5 + offset) % 256, (y * 7 + offset) % 256, (x * 3 + y * 3) % 256, x % 11 === 0 ? 127 : 255], i);
    }
  }
  return canvas;
}

function setup() {
  const source = sourceCanvas();
  const state = { originalCanvas: source, originalPixels: null, filterCache: null, currentFilter: 'daily400', strength: 80, seed: 42 };
  const renderCalls = [];
  const scope = {
    state,
    document: { createElement(tag) { assert.equal(tag, 'canvas'); return new MemoryCanvas(); } },
    renderFilter(context, image, id, options) {
      renderCalls.push(id);
      engine.render(context, image, id, options);
    },
  };
  vm.runInNewContext(paintSource, scope);
  const target = new MemoryCanvas(source.width, source.height);
  return { source, state, target, renderCalls, paint: scope.paintSelectedImage };
}

test('strength, original comparison and export reuse one full-strength calculation', () => {
  const { source, state, target, renderCalls, paint } = setup();
  const context = target.getContext('2d');
  for (const strength of [80, 40, 100, 0]) {
    state.strength = strength;
    paint(context);
  }
  assert.deepEqual(target.pixels, source.pixels, 'Zero strength must show original pixels');
  state.strength = 40;
  paint(context);
  const selected = target.pixels.slice();
  paint(context, true);
  assert.deepEqual(target.pixels, source.pixels, 'Comparison must show original pixels');
  const exportTarget = new MemoryCanvas(source.width, source.height);
  paint(exportTarget.getContext('2d'));
  assert.deepEqual(exportTarget.pixels, selected, 'Default/export paint must retain selected intensity');
  assert.deepEqual(renderCalls, ['daily400']);
});

test('cached intensity mixes RGB exactly and preserves alpha and source pixels', () => {
  const { source, state, target, paint } = setup();
  const original = source.pixels.slice();
  state.strength = 100;
  paint(target.getContext('2d'));
  const full = target.pixels.slice();
  state.strength = 40;
  paint(target.getContext('2d'));
  const expected = new Uint8ClampedArray(full.length);
  for (let i = 0; i < expected.length; i += 1) {
    expected[i] = i % 4 === 3 ? original[i] : original[i] + (full[i] - original[i]) * 0.4;
  }
  assert.deepEqual(target.pixels, expected);
  assert.deepEqual(source.pixels, original);
});

test('switching filters replaces the current cache and original needs no calculation', () => {
  const { source, state, target, renderCalls, paint } = setup();
  const context = target.getContext('2d');
  paint(context);
  const daily = target.pixels.slice();
  state.currentFilter = 'gold200';
  paint(context);
  assert.notDeepEqual(target.pixels, daily);
  assert.equal(state.filterCache.id, 'gold200');
  state.currentFilter = 'original';
  paint(context);
  assert.deepEqual(target.pixels, source.pixels);
  assert.deepEqual(renderCalls, ['daily400', 'gold200']);
  state.currentFilter = 'daily400';
  paint(context);
  assert.deepEqual(target.pixels, daily, 'Recomputed selection must retain the same grain');
  assert.deepEqual(renderCalls, ['daily400', 'gold200', 'daily400']);
});

test('a new photo and cleared cache produce pixels from the new source only', () => {
  const { state, target, renderCalls, paint } = setup();
  paint(target.getContext('2d'));
  const replacement = sourceCanvas(34, 20, 91);
  state.originalCanvas = replacement;
  state.originalPixels = null;
  state.filterCache = null;
  state.seed = 73;
  target.width = replacement.width;
  target.height = replacement.height;
  paint(target.getContext('2d'));
  const full = new MemoryCanvas(replacement.width, replacement.height);
  engine.render(full.getContext('2d'), replacement, state.currentFilter, { strength: 1, seed: 73 });
  const expected = new Uint8ClampedArray(full.pixels.length);
  for (let i = 0; i < expected.length; i += 1) {
    expected[i] = i % 4 === 3 ? replacement.pixels[i]
      : replacement.pixels[i] + (full.pixels[i] - replacement.pixels[i]) * state.strength / 100;
  }
  assert.deepEqual(target.pixels, expected);
  assert.equal(state.filterCache.full.data.length, replacement.width * replacement.height * 4);
  assert.deepEqual(renderCalls, ['daily400', 'daily400']);
});
