'use strict';

// Headless pixel QA for the actual product renderer. This is not a browser mock
// of image decoding or layout: Python supplies already-decoded RGBA pixels.
// Usage: node tests/render-photo-previews.cjs path/to/jobs.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');

const jobFile = process.argv[2];
if (!jobFile) throw new Error('Pass the JSON job file produced by photo-previews.py.');
const jobs = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const sandbox = { window: {} };
// Run this trusted project source in Node's main realm. vm.runInNewContext's
// global-object lookup overhead distorts per-pixel Math timings substantially.
// The explicit window argument keeps the product's browser API self-contained.
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'filters.js'), 'utf8'))(sandbox.window);
const engine = sandbox.window.VintageFilters;
const newPresetIds = [
  'album1991', 'school1994', 'summer1996', 'flash1998', 'minilab1995', 'camcorder1999',
  'expired-roll', 'sunfaded-slide', 'amber-print', 'rose-print', 'silver-print',
  'sepia-archive', 'half-frame', 'toy-lens', 'red-leak', 'warm-mist',
];
const selected = ['original', ...newPresetIds].map((id) => {
  const preset = engine.presets.find((item) => item.id === id);
  assert.ok(preset, `The new filter engine is not ready: ${id}`);
  return preset;
});

function makeContext(source) {
  return {
    canvas: { width: source.width, height: source.height },
    pixels: new Uint8ClampedArray(source.pixels.length),
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, stack: [],
    save() {
      this.stack.push({
        globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
        filter: this.filter, shadowColor: this.shadowColor, shadowBlur: this.shadowBlur,
      });
    },
    restore() { Object.assign(this, this.stack.pop()); },
    setTransform() {},
    clearRect() { this.pixels.fill(0); },
    drawImage(image) { this.pixels.set(image.pixels); },
    getImageData() {
      return { data: new Uint8ClampedArray(this.pixels), width: this.canvas.width, height: this.canvas.height };
    },
    putImageData(image) { this.pixels.set(image.data); },
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4), width, height }; },
  };
}

function hash(data) { return createHash('sha256').update(data).digest('hex'); }

function statistics(data, source) {
  const sum = [0, 0, 0];
  let black = 0;
  let white = 0;
  let clippedChannels = 0;
  let shadow = 0;
  let highlight = 0;
  let absoluteDifference = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    if (Math.max(r, g, b) <= 5) black += 1;
    if (Math.min(r, g, b) >= 250) white += 1;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (luma < 16) shadow += 1;
    if (luma > 239) highlight += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[i + channel];
      if (value === 0 || value === 255) clippedChannels += 1;
      absoluteDifference += Math.abs(value - source[i + channel]);
    }
    assert.equal(data[i + 3], source[i + 3], 'The renderer changed image alpha.');
  }
  const fraction = (value, total = count) => Number((value / total).toFixed(6));
  return {
    meanRGB: sum.map((value) => Number((value / count).toFixed(3))),
    fractionNearBlack: fraction(black), fractionNearWhite: fraction(white),
    fractionShadow: fraction(shadow), fractionHighlight: fraction(highlight),
    fractionClippedChannels: fraction(clippedChannels, count * 3),
    meanAbsoluteDifferenceFromOriginal: Number((absoluteDifference / (count * 3)).toFixed(3)),
  };
}

const report = [];
for (const job of jobs) {
  const input = fs.readFileSync(job.input);
  assert.equal(input.length, job.width * job.height * 4, 'Unexpected input length.');
  const source = { width: job.width, height: job.height, pixels: new Uint8ClampedArray(input) };
  const sourceHash = hash(source.pixels);
  fs.mkdirSync(job.output, { recursive: true });
  const results = [];
  for (const preset of selected) {
    const context = makeContext(source);
    const started = performance.now();
    engine.render(context, source, preset.id, { strength: 0.8, seed: 42 });
    const milliseconds = Number((performance.now() - started).toFixed(2));
    assert.equal(hash(source.pixels), sourceHash, `Source changed while rendering ${preset.id}.`);
    const filename = path.join(job.output, preset.id + '.rgba');
    fs.writeFileSync(filename, context.pixels);
    results.push({
      id: preset.id, name: preset.name, category: preset.category,
      milliseconds, output: filename, hash: hash(context.pixels),
      ...statistics(context.pixels, source.pixels),
    });
  }
  const entry = {
    source: job.source, width: job.width, height: job.height,
    strength: 0.8, seed: 42, sourceHash, sourceUnchanged: true, results,
  };
  fs.writeFileSync(path.join(job.output, 'metrics.json'), JSON.stringify(entry, null, 2));
  report.push(entry);
  console.log(`${path.basename(job.source)}: ${results.length} results, longest ${Math.max(...results.map((item) => item.milliseconds))}ms, source unchanged`);
}
fs.writeFileSync(path.join(path.dirname(path.resolve(jobFile)), 'metrics.json'), JSON.stringify(report, null, 2));
