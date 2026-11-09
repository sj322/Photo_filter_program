'use strict';

// Retains the previous test command while replacing the removed UI pixel-cache
// contract with the current worker/cache/coordinator contract. These are Node
// orchestration tests, not browser rendering, decoding or download checks.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const workerSource = readFileSync(path.join(__dirname, '..', 'render-worker.js'), 'utf8');
const controllerSource = readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function workerHarness() {
  const messages = [];
  const calls = [];
  const canvases = [];
  const controls = { failBlob: false, failBitmap: false, delayBitmap: null };
  const bitmap = (width, height, values) => ({
    width, height, pixels: Uint8ClampedArray.from(values || new Array(width * height * 4).fill(0)),
    closes: 0, close() { this.closes += 1; },
  });
  class Canvas {
    constructor(width, height) {
      this.width = width; this.height = height;
      this.pixels = new Uint8ClampedArray(width * height * 4);
      canvases.push(this);
    }
    getContext() {
      if (!this.context) this.context = {
        canvas: this, fillStyle: '#000000',
        fillRect() {
          assert.equal(this.fillStyle, '#ffffff');
          for (let i = 0; i < this.canvas.pixels.length; i += 4) this.canvas.pixels.set([255, 255, 255, 255], i);
        },
        drawImage(image) {
          if (image.failDraw) throw new Error('Could not copy image');
          assert.equal(this.canvas.width, image.width);
          assert.equal(this.canvas.height, image.height);
          for (let i = 0; i < image.pixels.length; i += 4) {
            const a = image.pixels[i + 3] / 255;
            const b = this.canvas.pixels[i + 3] / 255;
            const alpha = a + b * (1 - a);
            for (let channel = 0; channel < 3; channel += 1) {
              this.canvas.pixels[i + channel] = alpha
                ? (image.pixels[i + channel] * a + this.canvas.pixels[i + channel] * b * (1 - a)) / alpha : 0;
            }
            this.canvas.pixels[i + 3] = alpha * 255;
          }
        },
      };
      return this.context;
    }
    transferToImageBitmap() {
      return bitmap(this.width, this.height, this.pixels);
    }
    async convertToBlob(options) {
      if (controls.failBlob) throw new Error('Encoder failed');
      return { type: options.type, quality: options.quality, width: this.width, height: this.height, pixels: this.pixels.slice() };
    }
  }
  const core = {
    render(image, options) {
      calls.push({ options: plain(options), source: Array.from(image.pixels) });
      if (options.fail) throw new Error('Render failed');
      const output = new Canvas(image.width, image.height);
      output.pixels.set(image.pixels);
      if (!options.compare) {
        for (let i = 0; i < output.pixels.length; i += 4) if (output.pixels[i + 3]) output.pixels[i] += 10;
      }
      return output;
    },
  };
  const scope = {
    self: { postMessage(message, transfer = []) { messages.push({ ...message, transfer }); } },
    OffscreenCanvas: Canvas,
    importScripts(...files) {
      assert.deepEqual(files, ['filters.js', 'editor-core.js']);
      scope.self.VintageEditorCore = core;
    },
    async createImageBitmap(canvas) {
      if (controls.failBitmap) throw new Error('Bitmap failed');
      const result = bitmap(canvas.width, canvas.height, canvas.pixels);
      if (controls.delayBitmap) await controls.delayBitmap.promise;
      return result;
    },
  };
  vm.runInNewContext(workerSource, scope, { filename: 'render-worker.js' });
  const send = async (job) => { await scope.self.onmessage({ data: job }); return messages.at(-1); };
  const upload = async (version = 1, values = [30, 60, 90, 255, 10, 20, 30, 128]) => {
    const input = bitmap(2, 1, values);
    await send({ type: 'source', sourceVersion: version, bitmap: input });
    return input;
  };
  const job = (id, overrides = {}) => ({
    type: 'render', id, kind: 'preview', sourceVersion: 1,
    options: { filter: 'gold200', strength: 80, edits: { rotate: 0, aspect: 'original' }, maxDimension: 1440, seed: 42 },
    ...overrides,
  });
  return { scope, controls, calls, canvases, messages, bitmap, send, upload, job };
}

test('worker initializes its own source canvas, closes the transferred input and acknowledges the version', async () => {
  const h = workerHarness();
  const input = await h.upload(7);
  assert.equal(input.closes, 1);
  assert.equal(h.messages.at(-1).type, 'ready');
  assert.equal(h.messages.at(-1).sourceVersion, 7);
  const result = await h.send(h.job(1, { sourceVersion: 7 }));
  assert.equal(result.type, 'result');
  assert.equal(result.id, 1);
  assert.equal(result.filtered.width, 2);
  assert.equal(result.original.width, 2);
  assert.equal(result.transfer.length, 2);
  assert.equal(result.transfer[0], result.filtered);
  assert.equal(result.transfer[1], result.original);
  assert.equal(h.calls[0].options.filter, 'gold200');
  assert.equal(h.calls[1].options.compare, true);
});

test('worker rejects missing or stale sources and ignores unrelated messages', async () => {
  const h = workerHarness();
  const missing = await h.send(h.job(1));
  assert.equal(missing.error, 'Stale image');
  await h.upload(2);
  const stale = await h.send(h.job(2, { sourceVersion: 1 }));
  assert.equal(stale.error, 'Stale image');
  const count = h.messages.length;
  await h.send({ type: 'not-a-render' });
  assert.equal(h.messages.length, count);
  assert.equal(h.calls.length, 0);
});

test('comparison canvas is reused for tone changes and invalidated by geometry or source changes', async () => {
  const h = workerHarness();
  await h.upload();
  const first = h.job(1);
  await h.send(first);
  await h.send(h.job(2, { options: { ...first.options, filter: 'warm-mist', strength: 35, edits: { ...first.options.edits, exposure: 40 } } }));
  assert.equal(h.calls.filter((call) => call.options.compare).length, 1);
  await h.send(h.job(3, { options: { ...first.options, edits: { rotate: 90, aspect: '4:5' } } }));
  assert.equal(h.calls.filter((call) => call.options.compare).length, 2);
  await h.send(h.job(4, { options: { ...first.options, maxDimension: 720, edits: { rotate: 90, aspect: '4:5' } } }));
  assert.equal(h.calls.filter((call) => call.options.compare).length, 3);
  await h.upload(2);
  await h.send(h.job(5, { sourceVersion: 2, options: first.options }));
  assert.equal(h.calls.filter((call) => call.options.compare).length, 4);
});

test('worker JPEG export flattens transparency onto white and PNG preserves alpha', async () => {
  const h = workerHarness();
  await h.upload(1, [0, 0, 0, 0, 40, 80, 120, 128]);
  const jpeg = await h.send(h.job(1, { kind: 'export', format: 'image/jpeg', quality: 0.92 }));
  assert.equal(jpeg.blob.type, 'image/jpeg');
  assert.equal(jpeg.blob.quality, 0.92);
  assert.deepEqual(Array.from(jpeg.blob.pixels.slice(0, 4)), [255, 255, 255, 255]);
  assert.equal(jpeg.blob.pixels[7], 255);
  assert.ok(jpeg.blob.pixels[4] > 50, 'Semitransparent pixel must composite onto white');
  const png = await h.send(h.job(2, { kind: 'export', format: 'image/png', quality: 1 }));
  assert.equal(png.blob.type, 'image/png');
  assert.equal(png.blob.pixels[3], 0);
  assert.equal(png.blob.pixels[7], 128);
  assert.equal(h.calls.filter((call) => call.options.compare).length, 0, 'Export should not render a comparison canvas');
});

test('worker forwards init, render, bitmap and encoder failures without losing job IDs', async () => {
  const h = workerHarness();
  const broken = h.bitmap(2, 1);
  broken.failDraw = true;
  const init = await h.send({ type: 'source', sourceVersion: 1, bitmap: broken });
  assert.equal(init.type, 'init-error');
  assert.equal(broken.closes, 1);
  await h.upload();
  const failed = await h.send(h.job(17, { options: { ...h.job(0).options, fail: true } }));
  assert.equal(failed.id, 17);
  assert.equal(failed.error, 'Render failed');
  h.controls.failBitmap = true;
  const bitmap = await h.send(h.job(18));
  assert.equal(bitmap.id, 18);
  assert.equal(bitmap.error, 'Bitmap failed');
  h.controls.failBitmap = false;
  h.controls.failBlob = true;
  const blob = await h.send(h.job(19, { kind: 'export', format: 'image/png' }));
  assert.equal(blob.id, 19);
  assert.equal(blob.error, 'Encoder failed');
  h.controls.failBlob = false;
  assert.equal((await h.send(h.job(20))).error, undefined);
});

test('worker releases large export canvases after successful and failed encoding', async () => {
  for (const format of ['image/jpeg', 'image/png']) {
    for (const failBlob of [false, true]) {
      const h = workerHarness(); await h.upload();
      const source = h.canvases[0];
      h.controls.failBlob = failBlob;
      const result = await h.send(h.job(81, { kind: 'export', format, quality: 0.95 }));
      assert.equal(Boolean(result.error), failBlob);
      assert.equal(source.width, 2, 'The reusable source must remain intact');
      for (const output of h.canvases.slice(1)) {
        assert.equal(output.width, 1, 'Export width must be released after use');
        assert.equal(output.height, 1, 'Export height must be released after use');
      }
      if (!failBlob) assert.equal(result.blob.width, 2, 'The encoded result must keep its original size');
    }
  }
});

test('an older async preview retains its own pixels when a newer source arrives', async () => {
  const h = workerHarness();
  await h.upload(1, [30, 60, 90, 255, 10, 20, 30, 255]);
  const delay = deferred();
  h.controls.delayBitmap = delay;
  const oldRender = h.send(h.job(1));
  await h.upload(2, [180, 190, 200, 255, 210, 220, 230, 255]);
  h.controls.delayBitmap = null;
  delay.resolve();
  await oldRender;
  const oldResult = h.messages.find((message) => message.type === 'result' && message.id === 1);
  assert.equal(oldResult.original.pixels[0], 30);
  assert.equal(oldResult.filtered.pixels[0], 40);
  const newResult = await h.send(h.job(2, { sourceVersion: 2 }));
  assert.equal(newResult.original.pixels[0], 180);
  assert.equal(newResult.filtered.pixels[0], 190);
});

function functionSource(name, nextName) {
  const start = controllerSource.indexOf('function ' + name + '(');
  const end = controllerSource.indexOf('\nfunction ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, name + ' should remain testable');
  return controllerSource.slice(start, end);
}

function coordinatorHarness() {
  const state = { source: {}, sourceVersion: 2, latestPreview: 20, inFlight: null,
    pendingPreview: null, pendingExport: null, worker: null, workerReady: 0, saving: false, rendering: false };
  const log = { draws: [], statuses: [], saved: [], local: [], posted: [], updates: 0 };
  const canvas = { hidden: true, setAttribute() {} };
  const scope = {
    state, mainCanvas: canvas, originalCanvas: {}, log,
    setStatus(...args) { log.statuses.push(args); },
    updateActions() { log.updates += 1; }, updateComparison() {},
    drawResult(target, image) { log.draws.push({ target, image }); },
    closeBitmaps(result) { result.filtered?.close?.(); result.original?.close?.(); },
    saveBlob(blob, job) { log.saved.push({ blob, job }); state.saving = false; },
    renderLocally(job) { log.local.push(job); },
    currentPreset() { return { name: '테스트' }; },
    $() { return { hidden: true }; },
  };
  vm.runInNewContext(functionSource('finishJob', 'flattenForExport') + '\n'
    + functionSource('pump', 'requestPreview'), scope);
  const image = () => ({ closes: 0, close() { this.closes += 1; } });
  return { scope, state, log, image };
}

test('coordinator displays only the latest preview and releases stale result bitmaps', () => {
  const h = coordinatorHarness();
  const obsolete = { id: 19, kind: 'preview', sourceVersion: 2 };
  h.state.inFlight = obsolete;
  const oldPixels = { filtered: h.image(), original: h.image() };
  h.scope.finishJob(obsolete, oldPixels);
  assert.equal(h.log.draws.length, 0);
  assert.equal(oldPixels.filtered.closes, 1);
  assert.equal(oldPixels.original.closes, 1);
  const current = { id: 20, kind: 'preview', sourceVersion: 2 };
  h.state.inFlight = current;
  const pixels = { filtered: h.image(), original: h.image() };
  h.scope.finishJob(current, pixels);
  assert.equal(h.log.draws.length, 2);
  assert.equal(pixels.filtered.closes, 1);
  assert.equal(h.state.inFlight, null);
  assert.equal(h.state.rendering, false);
});

test('coordinator ignores results and errors for replaced photos and cancels their exports', () => {
  const h = coordinatorHarness();
  const job = { id: 20, kind: 'preview', sourceVersion: 1 };
  h.state.inFlight = job;
  h.scope.finishJob(job, { filtered: h.image(), original: h.image() }, new Error('Old image error'));
  assert.equal(h.log.draws.length, 0);
  assert.equal(h.log.statuses.length, 0);
  h.state.saving = true;
  const exported = { id: 21, kind: 'export', sourceVersion: 1 };
  h.state.inFlight = exported;
  h.scope.finishJob(exported, { blob: {} });
  assert.equal(h.log.saved.length, 0);
  assert.equal(h.state.saving, false);
});

test('coordinator prioritizes export, waits for matching worker source and never starts two jobs', () => {
  const h = coordinatorHarness();
  h.state.pendingPreview = { id: 20, kind: 'preview', sourceVersion: 2 };
  h.state.pendingExport = { id: 21, kind: 'export', sourceVersion: 2 };
  h.state.worker = { postMessage(job) { h.log.posted.push(job); } };
  h.state.workerReady = 1;
  h.scope.pump();
  assert.equal(h.log.posted.length, 0);
  h.state.workerReady = 2;
  h.scope.pump();
  assert.equal(h.log.posted.length, 1);
  assert.equal(h.log.posted[0].id, 21);
  assert.equal(h.state.pendingPreview.id, 20);
  assert.equal(h.state.pendingExport, null);
  h.scope.pump();
  assert.equal(h.log.posted.length, 1);
});

test('coordinator saves a completed export then starts its pending preview locally', () => {
  const h = coordinatorHarness();
  const job = { id: 21, kind: 'export', sourceVersion: 2 };
  h.state.inFlight = job;
  h.state.saving = true;
  h.state.pendingPreview = { id: 22, kind: 'preview', sourceVersion: 2 };
  h.scope.finishJob(job, { blob: { type: 'image/png' } });
  assert.equal(h.log.saved.length, 1);
  assert.equal(h.state.saving, false);
  assert.equal(h.log.local.length, 1);
  assert.equal(h.log.local[0].id, 22);
  assert.equal(h.state.inFlight.id, 22);
});
