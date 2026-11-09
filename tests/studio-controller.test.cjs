'use strict';

// Runs the complete controller against the real HTML IDs and filter catalogue.
// DOM, image decoding and canvas drawing are stand-ins: this verifies controller
// events/state/persistence, not browser layout, pixels, codecs or downloads.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = (name) => readFileSync(path.join(root, name), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function clockHarness() {
  let now = 0, serial = 0;
  const tasks = new Map();
  const schedule = (callback, delay = 0) => {
    const id = ++serial;
    tasks.set(id, { id, at: now + Number(delay), callback });
    return id;
  };
  async function run(limit = Infinity) {
    let steps = 0;
    for (;;) {
      // Image/loadCanvas promises can queue another timer after several awaits.
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const next = [...tasks.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next || next.at > limit) break;
      assert.ok(++steps < 2000, 'controller timer queue must settle');
      tasks.delete(next.id); now = next.at; next.callback();
    }
    if (Number.isFinite(limit)) now = limit;
  }
  return { schedule, cancel: (id) => tasks.delete(id), now: () => now,
    flush: () => run(), advance: (ms) => run(now + ms) };
}

function studioHarness(saved = {}) {
  const clock = clockHarness(), ids = new Map(), storage = new Map(Object.entries(saved));
  const renders = [], thumbnails = [], draws = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.style = {};
      this.className = ''; this.value = ''; this.hidden = false; this.disabled = false;
      this.open = false; this.width = 1; this.height = 1; this.textContent = '';
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const values = new Set(this.className.split(/\s+/).filter(Boolean));
          const active = force === undefined ? !values.has(name) : force;
          if (active) values.add(name); else values.delete(name);
          this.className = [...values].join(' '); return active;
        },
      };
    }
    setAttribute(name, value) {
      value = String(value); this.attributes[name] = value;
      if (name === 'class') this.className = value;
      if (name === 'id') this.id = value;
      if (name === 'value') this.value = value;
      if (name === 'hidden' || name === 'disabled' || name === 'selected') this[name] = true;
      if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(child) {
      this.children.push(child); child.parentNode = this;
      if (this.tagName === 'SELECT' && (this.children.length === 1 || child.selected)) this.value = child.value;
      return child;
    }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parentNode = null; }); this.children = [];
      if (this.tagName === 'SELECT') this.value = '';
      this.append(...children);
    }
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const data = selector.match(/^\[data-([\w-]+)\]$/);
      return data ? Object.hasOwn(this.dataset, data[1]) : this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    dispatch(type, data = {}) {
      const event = { type, target: this, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...data };
      for (let node = this; node; node = node.parentNode) {
        for (const listener of node.listeners.get(type) || []) listener(event);
      }
      return event;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
    select() { this.focus(); }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { return !this.validationMessage; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
    getContext() {
      if (!this.context) this.context = {
        canvas: this,
        drawImage: (image) => {
          if (this.id === 'mainCanvas' || this.id === 'originalCanvas') {
            draws.push({ target: this.id, options: plain(image.renderOptions || {}) });
          }
        },
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        fillRect() {},
      };
      return this.context;
    }
  }
  const document = new Element('document');
  document.createElement = (tag) => new Element(tag);
  document.getElementById = (id) => {
    // The production controller explicitly null-checks these optional captions.
    if (id === 'filterName' || id === 'filterDescription') return null;
    assert.ok(ids.has(id), 'script.js references missing HTML ID: ' + id);
    return ids.get(id);
  };
  const stack = [document];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  for (const match of source('index.html').matchAll(/<(\/)?([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const [, closing, rawTag, attributes] = match, tag = rawTag.toLowerCase();
    if (closing) {
      if (stack.at(-1).tagName === tag.toUpperCase()) stack.pop();
      continue;
    }
    const node = new Element(tag);
    for (const attr of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      node.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    if (node.id) { assert.ok(!ids.has(node.id), 'duplicate HTML ID: ' + node.id); ids.set(node.id, node); }
    stack.at(-1).appendChild(node);
    if (tag === 'body') document.body = node;
    if (!voidTags.has(tag) && !/\/\s*$/.test(attributes)) stack.push(node);
  }
  class ImageStub {
    constructor() { this.width = this.naturalWidth = 12; this.height = this.naturalHeight = 18; }
    set src(value) { this.url = value; clock.schedule(() => this.onload(), 0); }
  }
  const scope = {
    document, console, Image: ImageStub, location: { protocol: 'file:' },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: clock.schedule, clearTimeout: clock.cancel,
    requestAnimationFrame: (callback) => clock.schedule(() => callback(clock.now()), 16),
    Date: class extends Date { static now() { return clock.now(); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    VINTAGE_DEMO_IMAGE: 'data:image/png;base64,test-placeholder',
    addEventListener() {},
  };
  scope.window = scope;
  const context = vm.createContext(scope);
  vm.runInContext(source('filters.js'), context, { filename: 'filters.js' });
  vm.runInContext(source('editor-core.js'), context, { filename: 'editor-core.js' });
  const realCore = scope.VintageEditorCore;
  scope.VintageFilters = { ...scope.VintageFilters,
    render: (_context, _image, id) => thumbnails.push(id),
  };
  scope.VintageEditorCore = { ...realCore,
    recommend: () => ['album1991', 'school1994', 'gold200', 'daily400', 'instant', 'silver-print'],
    render: (image, options) => {
      renders.push(plain(options));
      const output = new Element('canvas');
      Object.assign(output, realCore.orientedSize(image, options.edits, options.maxDimension));
      output.renderOptions = plain(options);
      return output;
    },
  };
  vm.runInContext(source('script.js'), context, { filename: 'script.js' });
  const api = scope.VintageStudio;
  const node = (id) => document.getElementById(id);
  const cards = () => node('filterRow').querySelectorAll('button');
  const filter = (id) => {
    const card = cards().find((button) => button.dataset.filter === id);
    assert.ok(card, 'filter button exists: ' + id); card.click();
  };
  const category = (id) => node('categoryRow').children.find((button) => button.dataset.category === id).click();
  const range = (id, value, commit = true) => {
    node(id).value = String(value); node(id).dispatch('input'); if (commit) node(id).dispatch('change');
  };
  const settle = async () => { const idle = api.whenIdle(); await clock.flush(); await idle; };
  return { api, node, clock, renders, thumbnails, draws, storage, cards, filter, category, range, settle,
    defaults: plain(realCore.defaults), snapshot: () => plain(api.snapshot()),
    canvas: (width, height) => Object.assign(new Element('canvas'), { width, height }) };
}

test('startup loads the demo and wires all 45 real filter cards and thumbnails', async () => {
  const h = studioHarness();
  await h.settle();
  assert.equal(h.cards().length, 45);
  assert.equal(new Set(h.thumbnails).size, 45);
  assert.equal(h.snapshot().filter, 'album1991');
  assert.equal(h.snapshot().sourceWidth, 12);
  assert.equal(h.snapshot().sourceHeight, 18);
  assert.equal(h.snapshot().historyLength, 1);
  assert.equal(h.node('mainCanvas').hidden, false);
  assert.equal(h.node('placeholder').hidden, true);
  assert.equal(h.node('exportBtn').disabled, false);
  assert.equal(h.node('statusMessage').hidden, true);
});

test('new collection, search, original categories and favorites expose the added looks', async () => {
  const h = studioHarness(); await h.settle();
  h.category('new');
  const fresh = h.cards().filter((card) => !card.hidden);
  assert.equal(fresh.length, 12);
  assert.ok(fresh.some((card) => card.dataset.filter === 'ccd2004'));
  h.node('filterSearch').value = '폴더폰'; h.node('filterSearch').dispatch('input');
  assert.deepEqual(h.cards().filter((card) => !card.hidden).map((card) => card.dataset.filter), ['keitai2006']);
  h.node('filterSearch').value = ''; h.node('filterSearch').dispatch('input');
  h.filter('ccd2004'); await h.settle();
  assert.equal(h.snapshot().filter, 'ccd2004');
  assert.equal(h.node('currentLook').textContent, h.api.filters.find((preset) => preset.id === 'ccd2004').name);
  h.category('digital');
  assert.ok(h.cards().some((card) => !card.hidden && card.dataset.filter === 'ccd2004'));
  h.node('favoriteBtn').click(); h.category('favorites');
  assert.deepEqual(h.cards().filter((card) => !card.hidden).map((card) => card.dataset.filter), ['ccd2004']);
});

test('delegated filter buttons and undo/redo restore settings and selected UI state', async () => {
  const h = studioHarness(); await h.settle();
  h.category('all'); h.filter('gold200'); await h.settle();
  assert.equal(h.snapshot().filter, 'gold200');
  assert.equal(h.snapshot().historyLength, 2);
  assert.equal(h.cards().find((card) => card.dataset.filter === 'gold200').getAttribute('aria-pressed'), 'true');
  h.node('undoBtn').click(); await h.settle();
  assert.equal(h.snapshot().filter, 'album1991');
  assert.equal(h.snapshot().historyIndex, 0);
  h.node('redoBtn').click(); await h.settle();
  assert.equal(h.snapshot().filter, 'gold200');
  assert.equal(h.snapshot().historyIndex, 1);
  assert.equal(h.node('redoBtn').disabled, true);
});

test('range input previews continuously but change commits one undo checkpoint', async () => {
  const h = studioHarness(); await h.settle();
  h.range('strengthInput', 35, false); h.range('strengthInput', 47, false);
  assert.equal(h.snapshot().strength, 47);
  assert.equal(h.snapshot().historyLength, 1);
  h.node('strengthInput').dispatch('change');
  h.range('exposureInput', 40); await h.settle();
  assert.equal(h.snapshot().historyLength, 3);
  assert.equal(h.snapshot().edits.exposure, 40);
  h.node('undoBtn').click(); await h.settle();
  assert.equal(h.snapshot().edits.exposure, 0);
  assert.equal(h.snapshot().strength, 47);
  h.node('undoBtn').click(); await h.settle();
  assert.equal(h.snapshot().strength, 80);
});

test('replacing a photo resets edits, comparison and history while preserving favorites', async () => {
  const h = studioHarness(); await h.settle();
  h.node('favoriteBtn').click(); h.filter('gold200'); h.range('contrastInput', 30);
  h.node('aspectInput').value = '4:5'; h.node('aspectInput').dispatch('change');
  h.node('rotateBtn').click(); h.node('compareBtn').click();
  await h.api.loadCanvas(h.canvas(8, 10), { name: 'Replacement' }); await h.settle();
  const state = h.snapshot();
  assert.equal(state.filter, 'original'); assert.equal(state.strength, 80);
  assert.deepEqual(state.edits, h.defaults);
  assert.equal(state.sourceWidth, 8); assert.equal(state.sourceHeight, 10);
  assert.equal(state.historyLength, 1); assert.equal(state.historyIndex, 0);
  assert.equal(h.node('comparisonLayer').hidden, true);
  assert.equal(h.node('compareControl').hidden, true);
  assert.equal(h.node('photoTitle').textContent, 'Replacement');
  assert.deepEqual(JSON.parse(h.storage.get('vintage-studio.favorites.v1')), ['album1991']);
  h.category('favorites');
  assert.deepEqual(h.cards().filter((card) => !card.hidden).map((card) => card.dataset.filter), ['album1991']);
});

test('recipe controls persist a new filter recipe and restore it in this and a fresh session', async () => {
  const h = studioHarness(); await h.settle();
  h.category('new'); h.filter('milk-tea'); h.range('strengthInput', 62); h.range('temperatureInput', -23);
  h.range('highlightsInput', -35); h.range('shadowsInput', 18);
  h.range('textureInput', 32); h.range('bloomInput', 75); h.range('skinProtectInput', 85);
  h.node('rotateBtn').click(); await h.settle();
  const expected = h.snapshot();
  h.node('saveRecipeBtn').click(); assert.equal(h.node('recipeDialog').open, true);
  h.node('recipeName').value = 'My warm afternoon'; h.node('confirmRecipeBtn').click();
  assert.equal(h.node('recipeDialog').open, false);
  const saved = JSON.parse(h.storage.get('vintage-studio.recipes.v1'));
  assert.equal(saved.length, 1); assert.equal(saved[0].name, 'My warm afternoon');
  assert.deepEqual(saved[0].settings, { filter: expected.filter, strength: expected.strength, edits: expected.edits });
  h.node('resetBtn').click(); await h.settle();
  h.node('recipeSelect').value = saved[0].id; h.node('recipeSelect').dispatch('change'); await h.settle();
  assert.equal(h.snapshot().filter, expected.filter); assert.deepEqual(h.snapshot().edits, expected.edits);
  const reopened = studioHarness(Object.fromEntries(h.storage)); await reopened.settle();
  assert.equal(reopened.node('recipeSelect').children.length, 2);
  reopened.node('recipeSelect').value = saved[0].id; reopened.node('recipeSelect').dispatch('change');
  await reopened.settle();
  assert.equal(reopened.snapshot().strength, 62); assert.deepEqual(reopened.snapshot().edits, expected.edits);
});

test('film finish controls reflect capabilities and preserve color strength through history', async () => {
  const h = studioHarness(); await h.settle();
  h.filter('warm-mist'); await h.settle();
  assert.equal(h.node('textureInput').disabled, false);
  assert.equal(h.node('halationInput').disabled, false);
  h.range('textureInput', 0); h.range('bloomInput', 125); h.range('halationInput', 40);
  h.range('skinProtectInput', 90); await h.settle();
  assert.equal(h.snapshot().strength, 80);
  assert.equal(h.snapshot().edits.texture, 0);
  assert.equal(h.node('bloomValue').value, '125%');
  const lastRender = h.renders.filter((options) => !options.compare).at(-1);
  assert.equal(lastRender.edits.halation, 40);
  assert.equal(lastRender.edits.skinProtect, 90);
  h.node('undoBtn').click(); await h.settle();
  assert.equal(h.snapshot().edits.skinProtect, 60);
  h.node('redoBtn').click(); await h.settle();
  assert.equal(h.snapshot().edits.skinProtect, 90);
  h.filter('silver-flash'); await h.settle();
  assert.equal(h.node('skinProtectInput').disabled, true);
  h.filter('original'); await h.settle();
  for (const key of ['texture', 'bloom', 'halation', 'skinProtect']) assert.equal(h.node(key + 'Input').disabled, true);
  assert.equal(h.node('highlightsInput').disabled, false);
});

test('older saved recipes receive safe film finish defaults without losing their existing edits', async () => {
  const h = studioHarness({ 'vintage-studio.recipes.v1': JSON.stringify([
    { id: 'old-recipe', name: 'Before upgrade', settings: { filter: 'gold200', strength: 73, edits: { temperature: 12, grain: 8 } } },
  ]) });
  await h.settle();
  h.node('recipeSelect').value = 'old-recipe'; h.node('recipeSelect').dispatch('change'); await h.settle();
  const { edits } = h.snapshot();
  assert.equal(h.snapshot().filter, 'gold200'); assert.equal(h.snapshot().strength, 73);
  assert.equal(edits.temperature, 12); assert.equal(edits.grain, 8);
  assert.equal(edits.texture, 100); assert.equal(edits.bloom, 100); assert.equal(edits.halation, 100);
  assert.equal(edits.skinProtect, 60); assert.equal(edits.highlights, 0); assert.equal(edits.shadows, 0);
});

test('rapid local previews suppress an in-flight stale result and paint only the latest settings', async () => {
  const h = studioHarness(); await h.settle();
  h.draws.length = 0; h.renders.length = 0;
  h.filter('school1994'); await h.clock.advance(0); // Starts the local job; pixels are due 16ms later.
  h.filter('gold200'); h.filter('instant');
  h.range('strengthInput', 29); h.range('saturationInput', -18);
  await h.settle();
  const painted = h.draws.filter((draw) => draw.target === 'mainCanvas');
  assert.equal(painted.length, 1);
  assert.equal(painted[0].options.filter, 'instant');
  assert.equal(painted[0].options.strength, 29);
  assert.equal(painted[0].options.edits.saturation, -18);
  assert.ok(h.renders.some((options) => options.filter === 'school1994'), 'the obsolete job actually ran');
  assert.equal(h.snapshot().filter, 'instant'); assert.equal(h.snapshot().rendering, false);
});
