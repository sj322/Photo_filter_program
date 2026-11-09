'use strict';

// Keep expensive image processing off the editor's UI thread when supported.
// The same core is also used directly for file:// and older browsers.
self.window = self;
self.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('Only canvas is supported in the render worker');
    return new OffscreenCanvas(1, 1);
  },
};
importScripts('filters.js', 'editor-core.js');
let source = null;
let sourceVersion = 0;
let originalCache = null;

self.onmessage = async (event) => {
  const job = event.data;
  if (job.type === 'source') {
    try {
      source = new OffscreenCanvas(job.bitmap.width, job.bitmap.height);
      source.getContext('2d').drawImage(job.bitmap, 0, 0);
      job.bitmap.close();
      sourceVersion = job.sourceVersion;
      originalCache = null;
      self.postMessage({ type: 'ready', sourceVersion });
    } catch (error) {
      job.bitmap?.close();
      self.postMessage({ type: 'init-error', error: error.message });
    }
    return;
  }
  if (job.type !== 'render') return;
  try {
    if (!source || job.sourceVersion !== sourceVersion) throw new Error('Stale image');
    const filtered = self.VintageEditorCore.render(source, job.options);
    if (job.kind === 'export') {
      let output = filtered;
      if (job.format === 'image/jpeg') {
        output = new OffscreenCanvas(filtered.width, filtered.height);
        const context = output.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, output.width, output.height);
        context.drawImage(filtered, 0, 0);
        filtered.width = filtered.height = 1;
      }
      try {
        const blob = await output.convertToBlob({ type: job.format, quality: job.quality });
        self.postMessage({ type: 'result', id: job.id, blob });
      } finally {
        // Release the large export surface after encoding, including failures.
        output.width = output.height = 1;
      }
    } else {
      const key = JSON.stringify([sourceVersion, job.options.maxDimension, job.options.edits.rotate, job.options.edits.aspect]);
      if (!originalCache || originalCache.key !== key) {
        originalCache = { key, canvas: self.VintageEditorCore.render(source, { ...job.options, compare: true }) };
      }
      const original = await createImageBitmap(originalCache.canvas);
      const bitmap = filtered.transferToImageBitmap();
      self.postMessage({ type: 'result', id: job.id, filtered: bitmap, original }, [bitmap, original]);
    }
  } catch (error) {
    self.postMessage({ type: 'result', id: job.id, error: error.message });
  }
};
