'use strict';

const $ = (id) => document.getElementById(id);
const Core = window.VintageEditorCore;
const { presets } = window.VintageFilters;
const validFilters = new Set(presets.map((preset) => preset.id));
const PREVIEW_SIZE = 1440;
const STORAGE = { favorites: 'vintage-studio.favorites.v1', recipes: 'vintage-studio.recipes.v1' };
const categories = [
  ['recommended', '추천'], ['new', '새로운 룩'], ['all', '전체'], ['favorites', '즐겨찾기'],
  ['nineties', '90년대'], ['vintage', '빈티지'], ['retro', '레트로'],
  ['film', '필름'], ['digital', '디카'], ['cinema', '시네마'], ['mono', '흑백'], ['classic', '오리지널 컬렉션'],
];
const filterDetailKeys = ['texture', 'bloom', 'halation', 'skinProtect'];
const adjustmentKeys = ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation', 'fade', 'grain', 'vignette', ...filterDetailKeys];
const defaultSettings = () => ({ filter: 'original', strength: 80, edits: { ...Core.defaults } });
const copy = (value) => JSON.parse(JSON.stringify(value));
function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
}
function normalizeSettings(value) {
  return {
    filter: validFilters.has(value?.filter) ? value.filter : 'original',
    strength: Math.max(0, Math.min(100, Number.isFinite(Number(value?.strength)) ? Number(value.strength) : 80)),
    edits: Core.normalizeEdits(value?.edits),
  };
}
const storedFavorites = readStorage(STORAGE.favorites, []);
const storedRecipes = readStorage(STORAGE.recipes, []);
const state = {
  source: null, sourceVersion: 0, name: '', demo: false, settings: defaultSettings(),
  category: 'recommended', search: '', recommended: [],
  favorites: new Set(Array.isArray(storedFavorites) ? storedFavorites.filter((id) => validFilters.has(id) && id !== 'original') : []),
  recipes: Array.isArray(storedRecipes) ? storedRecipes.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
    .slice(0, 24).map((item) => ({ id: item.id.slice(0, 80), name: item.name.slice(0, 30), settings: normalizeSettings(item.settings) })) : [],
  history: [], historyIndex: -1, comparing: false, spaceHeld: false, loading: false,
  saving: false, rendering: false, loadToken: 0, thumbnailToken: 0, seed: 42,
  jobId: 0, latestPreview: 0, pendingPreview: null, pendingExport: null, inFlight: null,
  worker: null, workerReady: 0, timer: 0,
};
const filterButtons = new Map();
const mainCanvas = $('mainCanvas');
const originalCanvas = $('originalCanvas');

function setStatus(message = '', error = false) {
  $('statusMessage').textContent = message;
  $('statusMessage').hidden = !message;
  $('statusMessage').classList.toggle('error', error);
}
function currentPreset() { return presets.find((preset) => preset.id === state.settings.filter); }
function snapshot() {
  return { ...copy(state.settings), sourceWidth: state.source?.width || 0, sourceHeight: state.source?.height || 0,
    rendering: state.rendering, loading: state.loading, saving: state.saving,
    historyIndex: state.historyIndex, historyLength: state.history.length };
}
function checkpoint() {
  const next = copy(state.settings);
  if (JSON.stringify(state.history[state.historyIndex]) === JSON.stringify(next)) return;
  state.history.splice(state.historyIndex + 1);
  state.history.push(next);
  if (state.history.length > 40) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateActions();
}
function undo() {
  if (!state.source || state.historyIndex < 1) return;
  state.settings = copy(state.history[--state.historyIndex]);
  state.comparing = false;
  syncUI();
  requestPreview();
}
function redo() {
  if (!state.source || state.historyIndex >= state.history.length - 1) return;
  state.settings = copy(state.history[++state.historyIndex]);
  state.comparing = false;
  syncUI();
  requestPreview();
}
function updateActions() {
  const loaded = Boolean(state.source);
  const busy = state.loading || state.saving;
  for (const id of ['uploadBtn', 'pickPhotoBtn', 'demoBtn']) $(id).disabled = busy;
  $('exportBtn').disabled = !loaded || busy;
  $('confirmExportBtn').disabled = !loaded || busy;
  $('confirmExportBtn').textContent = state.saving ? '사진을 만드는 중…' : '사진 저장하기';
  $('undoBtn').disabled = !loaded || state.historyIndex < 1 || busy;
  $('redoBtn').disabled = !loaded || state.historyIndex >= state.history.length - 1 || busy;
  for (const id of ['compareBtn', 'saveRecipeBtn', 'rotateBtn', 'resetBtn', 'aspectInput', 'recipeSelect']) $(id).disabled = !loaded || busy;
  for (const key of adjustmentKeys) $(key + 'Input').disabled = !loaded || busy;
  const capabilities = window.VintageFilters.getCapabilities?.(state.settings.filter);
  for (const key of filterDetailKeys) {
    const supported = state.settings.filter !== 'original' && capabilities?.[key] !== false;
    $(key + 'Input').disabled = !loaded || busy || !supported;
    $(key + 'Input').title = supported ? '' : '이 필터에는 적용되지 않는 조절입니다.';
  }
  $('strengthInput').disabled = !loaded || state.settings.filter === 'original' || busy;
  $('favoriteBtn').disabled = !loaded || state.settings.filter === 'original';
  $('deleteRecipeBtn').disabled = !$('recipeSelect').value || busy;
  document.body.dataset.loaded = String(loaded);
  document.body.dataset.busy = String(state.rendering || state.saving);
  $('renderIndicator').hidden = !state.rendering && !state.saving;
  mainCanvas.setAttribute('aria-busy', String(state.rendering));
}
function syncUI() {
  const preset = currentPreset();
  $('strengthInput').value = state.settings.strength;
  $('strengthValue').value = state.settings.filter === 'original' ? '—' : state.settings.strength + '%';
  $('currentLook').textContent = preset.name;
  const nameTarget = $('filterName');
  if (nameTarget) nameTarget.textContent = preset.name;
  const descriptionTarget = $('filterDescription');
  if (descriptionTarget) descriptionTarget.textContent = preset.description;
  for (const key of adjustmentKeys) {
    const value = state.settings.edits[key];
    $(key + 'Input').value = value;
    $(key + 'Value').value = key === 'exposure' ? (value > 0 ? '+' : '') + (value / 100).toFixed(2) + ' EV'
      : filterDetailKeys.includes(key) ? value + '%' : (value > 0 ? '+' : '') + value;
  }
  $('aspectInput').value = state.settings.edits.aspect;
  $('rotateBtn').setAttribute('aria-label', '오른쪽으로 90도 회전, 현재 ' + state.settings.edits.rotate + '도');
  const favorite = state.favorites.has(preset.id);
  $('favoriteBtn').setAttribute('aria-pressed', String(favorite));
  $('favoriteBtn').setAttribute('aria-label', favorite ? '현재 필터 즐겨찾기 해제' : '현재 필터 즐겨찾기 추가');
  $('favoriteBtn').title = favorite ? '즐겨찾기 해제' : '즐겨찾기 추가';
  for (const [id, button] of filterButtons) {
    button.classList.toggle('active', id === preset.id);
    button.setAttribute('aria-pressed', String(id === preset.id));
    button.querySelector('.favorite-marker').hidden = !state.favorites.has(id);
  }
  if (state.source) {
    const size = Core.orientedSize(state.source, state.settings.edits, 4096);
    $('imageMeta').textContent = size.width + ' × ' + size.height + ' · ' + (state.demo ? '샘플 사진' : '내 사진');
  }
  showFilters();
  updateComparison();
  updateActions();
}
function updateComparison() {
  const visible = Boolean(state.source) && (state.comparing || state.spaceHeld);
  $('comparisonLayer').hidden = !visible;
  $('comparisonDivider').hidden = !state.comparing || state.spaceHeld;
  $('compareControl').hidden = !state.comparing;
  $('compareBtn').setAttribute('aria-pressed', String(state.comparing));
  const position = state.spaceHeld ? 100 : Number($('comparePosition').value);
  $('comparisonLayer').style.clipPath = 'inset(0 ' + (100 - position) + '% 0 0)';
  $('comparisonDivider').style.left = position + '%';
  $('comparePosition').setAttribute('aria-valuetext', '원본 ' + position + '%, 보정 ' + (100 - position) + '%');
}

for (const [id, label] of categories) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-btn';
  button.dataset.category = id;
  button.textContent = label;
  button.setAttribute('aria-pressed', String(id === state.category));
  $('categoryRow').appendChild(button);
}
for (const preset of presets) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter-btn';
  button.dataset.filter = preset.id;
  button.setAttribute('aria-label', preset.name);
  button.setAttribute('aria-pressed', 'false');
  button.title = preset.description;
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 140;
  canvas.className = 'filter-preview';
  canvas.setAttribute('aria-hidden', 'true');
  const info = document.createElement('span');
  info.className = 'filter-card-info';
  const label = document.createElement('span');
  label.className = 'filter-label'; label.textContent = preset.name;
  const badge = document.createElement('span');
  badge.className = 'filter-badge'; badge.textContent = preset.badge;
  const star = document.createElement('span');
  star.className = 'favorite-marker'; star.textContent = '★';
  star.setAttribute('aria-hidden', 'true');
  info.append(label, badge); button.append(canvas, info, star);
  $('filterRow').appendChild(button);
  filterButtons.set(preset.id, button);
}
$('filterCount').textContent = (presets.length - 1) + ' LOOKS';

function showFilters() {
  let count = 0;
  const query = state.search.trim().toLocaleLowerCase();
  for (const preset of presets) {
    const categoryMatch = state.category === 'all'
      || (state.category === 'recommended' && (preset.id === 'original' || preset.id === state.settings.filter || state.recommended.includes(preset.id)))
      || (state.category === 'favorites' && state.favorites.has(preset.id))
      || preset.category === state.category || preset.categories?.includes(state.category);
    const matches = categoryMatch && (!query || (preset.name + ' ' + preset.id + ' ' + preset.description).toLocaleLowerCase().includes(query));
    filterButtons.get(preset.id).hidden = !matches;
    if (matches) count++;
  }
  $('categoryRow').querySelectorAll('button').forEach((button) => {
    const active = button.dataset.category === state.category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('emptyFilters').hidden = count > 0;
  $('emptyFilters').textContent = state.category === 'favorites' && !query
    ? '마음에 드는 필터에 별을 눌러 모아보세요.' : '찾는 필터가 없어요. 다른 이름이나 컬렉션을 골라보세요.';
}
$('categoryRow').addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  state.category = button.dataset.category;
  showFilters();
  $('filterRow').scrollTop = $('filterRow').scrollLeft = 0;
});
$('filterSearch').addEventListener('input', () => { state.search = $('filterSearch').value; showFilters(); });
$('filterRow').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button || !state.source || state.loading || state.saving) return;
  state.settings.filter = button.dataset.filter;
  state.comparing = false;
  checkpoint(); syncUI(); requestPreview();
});
$('favoriteBtn').addEventListener('click', () => {
  const id = state.settings.filter;
  if (id === 'original') return;
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  const saved = writeStorage(STORAGE.favorites, [...state.favorites]);
  showFilters(); syncUI();
  if (!saved) setStatus('즐겨찾기는 이번 창에서만 유지돼요. 브라우저 저장 공간을 사용할 수 없어요.');
});
function selectTab(tab) {
  const filters = tab === 'filters';
  $('filtersPanel').hidden = !filters; $('adjustPanel').hidden = filters;
  $('filterTab').setAttribute('aria-selected', String(filters)); $('adjustTab').setAttribute('aria-selected', String(!filters));
  $('filterTab').tabIndex = filters ? 0 : -1; $('adjustTab').tabIndex = filters ? -1 : 0;
}
$('filterTab').addEventListener('click', () => selectTab('filters'));
$('adjustTab').addEventListener('click', () => selectTab('adjust'));
for (const id of ['filterTab', 'adjustTab']) $(id).addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const next = id === 'filterTab' ? 'adjust' : 'filters';
    selectTab(next); $(next === 'filters' ? 'filterTab' : 'adjustTab').focus();
  }
});
$('strengthInput').addEventListener('input', () => {
  state.settings.strength = Number($('strengthInput').value);
  syncUI(); requestPreview(65);
});
$('strengthInput').addEventListener('change', checkpoint);
for (const key of adjustmentKeys) {
  $(key + 'Input').addEventListener('input', () => {
    state.settings.edits[key] = Number($(key + 'Input').value);
    syncUI(); requestPreview(65);
  });
  $(key + 'Input').addEventListener('change', checkpoint);
}
$('aspectInput').addEventListener('change', () => {
  state.settings.edits.aspect = $('aspectInput').value; checkpoint(); syncUI(); requestPreview();
});
$('rotateBtn').addEventListener('click', () => {
  state.settings.edits.rotate = (state.settings.edits.rotate + 90) % 360; checkpoint(); syncUI(); requestPreview();
});
$('resetBtn').addEventListener('click', () => {
  state.settings = defaultSettings(); state.comparing = false;
  checkpoint(); syncUI(); requestPreview(); setStatus('편집을 초기화했어요. 되돌리기로 이전 상태를 복원할 수 있어요.');
});
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('compareBtn').addEventListener('click', () => { state.comparing = !state.comparing; updateComparison(); });
$('comparePosition').addEventListener('input', updateComparison);

function drawResult(canvas, image) {
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
}
function closeBitmaps(result) {
  result.filtered?.close?.(); result.original?.close?.();
}
function finishJob(job, result, error) {
  const currentSource = job.sourceVersion === state.sourceVersion;
  if (error) {
    if (currentSource) setStatus('사진을 처리하지 못했어요. 다른 설정이나 사진으로 다시 시도해주세요.', true);
    if (job.kind === 'export') { state.saving = false; updateActions(); }
  } else if (job.kind === 'export') {
    if (currentSource) saveBlob(result.blob, job);
    else { state.saving = false; updateActions(); }
  } else if (currentSource && job.id === state.latestPreview) {
    drawResult(mainCanvas, result.filtered);
    drawResult(originalCanvas, result.original);
    mainCanvas.hidden = false;
    mainCanvas.setAttribute('aria-label', currentPreset().name + ' 적용 사진');
    $('placeholder').hidden = true;
  }
  closeBitmaps(result || {});
  if (state.inFlight?.id === job.id) state.inFlight = null;
  state.rendering = Boolean(state.pendingPreview || (state.inFlight && state.inFlight.kind === 'preview'));
  updateActions(); updateComparison();
  pump();
}
function flattenForExport(canvas, format) {
  if (format !== 'image/jpeg') return canvas;
  const flat = document.createElement('canvas');
  flat.width = canvas.width; flat.height = canvas.height;
  const context = flat.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, flat.width, flat.height); context.drawImage(canvas, 0, 0);
  return flat;
}
function renderLocally(job) {
  setTimeout(() => {
    try {
      if (job.sourceVersion !== state.sourceVersion) { finishJob(job, {}); return; }
      const filtered = Core.render(state.source, job.options);
      if (job.kind === 'export') {
        const output = flattenForExport(filtered, job.format);
        if (output !== filtered) filtered.width = filtered.height = 1;
        output.toBlob((blob) => {
          output.width = output.height = 1;
          finishJob(job, { blob }, blob ? null : new Error('Empty export'));
        }, job.format, job.quality);
      } else {
        const original = Core.render(state.source, { ...job.options, compare: true });
        finishJob(job, { filtered, original });
      }
    } catch (error) { finishJob(job, {}, error); }
  }, 16);
}
function pump() {
  if (state.inFlight || !state.source) return;
  const job = state.pendingExport || state.pendingPreview;
  if (!job) return;
  if (state.worker && state.workerReady !== state.sourceVersion) return;
  if (job.kind === 'export') state.pendingExport = null; else state.pendingPreview = null;
  state.inFlight = job;
  if (state.worker) state.worker.postMessage({ type: 'render', ...job });
  else renderLocally(job);
}
function requestPreview(delay = 0) {
  if (!state.source) return;
  clearTimeout(state.timer);
  const job = {
    kind: 'preview', id: ++state.jobId, sourceVersion: state.sourceVersion,
    options: { ...copy(state.settings), maxDimension: PREVIEW_SIZE, seed: state.seed },
  };
  state.latestPreview = job.id; state.pendingPreview = job; state.rendering = true;
  updateActions();
  state.timer = setTimeout(() => { state.timer = 0; pump(); }, delay);
}
function fallBackFromWorker() {
  state.worker?.terminate(); state.worker = null; state.workerReady = 0;
  const job = state.inFlight; state.inFlight = null;
  if (job?.kind === 'export') state.pendingExport = job;
  if (!state.pendingPreview && job?.kind === 'preview') state.pendingPreview = job;
  pump();
}
function setupWorker() {
  if (!/^https?:$/.test(location.protocol) || !window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) return;
  try {
    state.worker = new Worker('render-worker.js');
    state.worker.onerror = () => fallBackFromWorker();
    state.worker.onmessage = (event) => {
      const result = event.data;
      if (result.type === 'ready') {
        if (result.sourceVersion === state.sourceVersion) { state.workerReady = result.sourceVersion; pump(); }
      } else if (result.type === 'result') {
        const job = state.inFlight;
        if (job && job.id === result.id) finishJob(job, result, result.error ? new Error(result.error) : null);
        else closeBitmaps(result);
      } else if (result.type === 'init-error') fallBackFromWorker();
    };
  } catch (_) { state.worker = null; }
}
async function sendWorkerSource(version) {
  if (!state.worker) { pump(); return; }
  state.workerReady = 0;
  try {
    const bitmap = await createImageBitmap(state.source);
    if (version !== state.sourceVersion || !state.worker) { bitmap.close(); return; }
    state.worker.postMessage({ type: 'source', sourceVersion: version, bitmap }, [bitmap]);
  } catch (_) { fallBackFromWorker(); }
}
async function loadCanvas(image, { name = '내 사진', demo = false } = {}) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('Empty image');
  const scale = Math.min(1, 4096 / Math.max(width, height));
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(width * scale)); source.height = Math.max(1, Math.round(height * scale));
  const context = source.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, source.width, source.height);
  context.getImageData(0, 0, 1, 1);
  state.source = source; state.sourceVersion++; state.seed = (state.seed + 7919) >>> 0;
  state.name = name; state.demo = demo; state.settings = defaultSettings();
  if (demo) state.settings.filter = 'album1991';
  state.category = 'recommended'; state.search = ''; $('filterSearch').value = '';
  state.recommended = Core.recommend(source);
  state.history = []; state.historyIndex = -1; checkpoint();
  state.comparing = state.spaceHeld = false;
  $('photoTitle').textContent = name;
  $('recipeSelect').value = '';
  showFilters(); syncUI(); selectTab('filters');
  generateThumbnails(source);
  await sendWorkerSource(state.sourceVersion);
  requestPreview();
}
function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unsupported image')); image.src = url;
  });
}
async function loadImageFile(file) {
  if (state.saving) return;
  const token = ++state.loadToken;
  state.loading = true; updateActions(); setStatus('사진을 불러오는 중이에요…');
  let url;
  try {
    if (file.type && !file.type.startsWith('image/')) throw new Error('Unsupported file');
    url = URL.createObjectURL(file);
    const image = await decodeImage(url);
    if (token !== state.loadToken) return;
    await loadCanvas(image, { name: file.name.replace(/\.[^.]+$/, '') || '내 사진' });
    if (token === state.loadToken) setStatus(Math.max(image.naturalWidth, image.naturalHeight) > 4096 ? '큰 사진은 긴 변 4096px로 불러왔어요.' : '');
  } catch (_) {
    if (token === state.loadToken) setStatus('사진을 열 수 없어요. JPG, PNG, WebP 이미지로 다시 시도해주세요.', true);
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (token === state.loadToken) { state.loading = false; updateActions(); }
  }
}
async function loadDemo() {
  if (state.saving) return;
  const token = ++state.loadToken; state.loading = true; updateActions();
  try {
    if (!window.VINTAGE_DEMO_IMAGE) throw new Error('Missing sample');
    const image = await decodeImage(window.VINTAGE_DEMO_IMAGE);
    if (token !== state.loadToken) return;
    await loadCanvas(image, { name: 'A quiet afternoon', demo: true });
    if (token === state.loadToken) setStatus('');
  } catch (_) { if (token === state.loadToken) setStatus('샘플을 열 수 없어요. 내 사진을 선택해 시작해주세요.'); }
  finally { if (token === state.loadToken) { state.loading = false; updateActions(); } }
}
function generateThumbnails(source) {
  const token = ++state.thumbnailToken;
  const thumb = document.createElement('canvas'); thumb.width = 120; thumb.height = 140;
  const scale = Math.max(120 / source.width, 140 / source.height);
  const context = thumb.getContext('2d'); context.imageSmoothingQuality = 'high';
  context.drawImage(source, (120 - source.width * scale) / 2, (140 - source.height * scale) / 2, source.width * scale, source.height * scale);
  const ordered = [...presets].sort((a, b) => Number(state.recommended.includes(b.id)) - Number(state.recommended.includes(a.id)));
  let index = 0;
  function next() {
    if (token !== state.thumbnailToken) return;
    const preset = ordered[index++];
    const target = filterButtons.get(preset.id).querySelector('canvas');
    try { window.VintageFilters.render(target.getContext('2d'), thumb, preset.id, { strength: 0.8, seed: state.seed }); }
    catch (_) { target.getContext('2d').drawImage(thumb, 0, 0); }
    if (index < ordered.length) requestAnimationFrame(next);
  }
  requestAnimationFrame(next);
}
for (const id of ['uploadBtn', 'pickPhotoBtn']) $(id).addEventListener('click', () => $('fileInput').click());
$('demoBtn').addEventListener('click', loadDemo);
$('fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0]; if (file) loadImageFile(file); event.target.value = '';
});
let dragDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth++; $('dropOverlay').hidden = false;
});
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('dragleave', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true;
});
document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
  loadImageFile(event.dataTransfer.files[0]);
});
document.addEventListener('paste', (event) => {
  if (/INPUT|TEXTAREA/.test(event.target.tagName)) return;
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'));
  if (item) { event.preventDefault(); loadImageFile(item.getAsFile()); }
});

function refreshRecipes() {
  const selected = $('recipeSelect').value;
  $('recipeSelect').replaceChildren();
  const initial = document.createElement('option'); initial.value = ''; initial.textContent = '저장한 레시피';
  $('recipeSelect').appendChild(initial);
  for (const recipe of state.recipes) {
    const option = document.createElement('option'); option.value = recipe.id; option.textContent = recipe.name;
    $('recipeSelect').appendChild(option);
  }
  if (state.recipes.some((item) => item.id === selected)) $('recipeSelect').value = selected;
  updateActions();
}
$('saveRecipeBtn').addEventListener('click', () => {
  $('recipeName').value = currentPreset().name + ' 레시피';
  $('recipeDialog').showModal(); $('recipeName').select();
});
$('cancelRecipeBtn').addEventListener('click', () => $('recipeDialog').close());
$('confirmRecipeBtn').addEventListener('click', () => {
  const name = $('recipeName').value.trim().slice(0, 30);
  if (!name) { $('recipeName').focus(); $('recipeName').setCustomValidity('레시피 이름을 입력해주세요.'); $('recipeName').reportValidity(); return; }
  if (state.recipes.length >= 24) { setStatus('레시피는 24개까지 저장할 수 있어요. 사용하지 않는 레시피를 정리해주세요.'); $('recipeDialog').close(); return; }
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, settings: copy(state.settings) };
  state.recipes.push(item);
  const saved = writeStorage(STORAGE.recipes, state.recipes);
  refreshRecipes(); $('recipeSelect').value = item.id; updateActions(); $('recipeDialog').close();
  setStatus(saved ? '레시피를 이 브라우저에 저장했어요. 다른 사진에도 적용해보세요.' : '레시피는 이번 창에서만 유지돼요. 브라우저 저장 공간을 사용할 수 없어요.');
});
$('recipeName').addEventListener('input', () => $('recipeName').setCustomValidity(''));
$('recipeName').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('confirmRecipeBtn').click(); } });
$('recipeSelect').addEventListener('change', () => {
  const recipe = state.recipes.find((item) => item.id === $('recipeSelect').value);
  if (recipe) { state.settings = normalizeSettings(recipe.settings); state.comparing = false; checkpoint(); syncUI(); requestPreview(); }
  updateActions();
});
$('deleteRecipeBtn').addEventListener('click', () => {
  const id = $('recipeSelect').value;
  if (!id) return;
  state.recipes = state.recipes.filter((item) => item.id !== id);
  const saved = writeStorage(STORAGE.recipes, state.recipes);
  refreshRecipes(); setStatus(saved ? '선택한 레시피를 삭제했어요.' : '이번 창에서 삭제했어요. 브라우저 저장 공간에는 변경하지 못했어요.');
});

function updateExportSummary() {
  if (!state.source) return;
  const size = Core.orientedSize(state.source, state.settings.edits, Number($('exportSize').value));
  const jpeg = $('exportFormat').value === 'image/jpeg';
  $('qualityRow').hidden = !jpeg;
  $('qualityValue').value = $('exportQuality').value + '%';
  $('exportSummary').textContent = size.width + ' × ' + size.height + ' px · ' + (jpeg ? 'JPEG · 투명 영역은 흰색으로 저장' : 'PNG · 투명도 유지');
}
$('exportBtn').addEventListener('click', () => { updateExportSummary(); $('exportDialog').showModal(); });
for (const id of ['closeExportBtn', 'cancelExportBtn']) $(id).addEventListener('click', () => { if (!state.saving) $('exportDialog').close(); });
$('exportDialog').addEventListener('cancel', (event) => { if (state.saving) event.preventDefault(); });
for (const id of ['exportSize', 'exportFormat', 'exportQuality']) $(id).addEventListener('input', updateExportSummary);
$('confirmExportBtn').addEventListener('click', () => {
  if (!state.source || state.saving) return;
  state.saving = true; updateActions();
  const format = $('exportFormat').value;
  state.pendingExport = {
    id: ++state.jobId, kind: 'export', sourceVersion: state.sourceVersion,
    options: { ...copy(state.settings), maxDimension: Number($('exportSize').value), seed: state.seed },
    format, quality: Number($('exportQuality').value) / 100,
    filename: 'vintage-studio_' + state.settings.filter + '_' + Date.now() + (format === 'image/jpeg' ? '.jpg' : '.png'),
  };
  pump();
});
function saveBlob(blob, job) {
  try {
    if (!blob) throw new Error('Empty image');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = job.filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('exportDialog').close();
    setStatus('사진이 준비됐어요. 브라우저 다운로드에서 확인해주세요.');
  } catch (_) { setStatus('저장하지 못했어요. 다시 시도해주세요.', true); }
  finally { state.saving = false; updateActions(); }
}
document.addEventListener('keydown', (event) => {
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || $('exportDialog').open || $('recipeDialog').open) return;
  if (!state.source) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); if (event.shiftKey) redo(); else undo();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault(); redo();
  } else if (event.code === 'Space' && !event.repeat && event.target.tagName !== 'BUTTON') {
    event.preventDefault(); state.spaceHeld = true; updateComparison();
  }
});
document.addEventListener('keyup', (event) => { if (event.code === 'Space') { state.spaceHeld = false; updateComparison(); } });
window.addEventListener('blur', () => { state.spaceHeld = false; dragDepth = 0; $('dropOverlay').hidden = true; updateComparison(); });

function whenIdle() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (!state.loading && !state.rendering && !state.saving && !state.inFlight && !state.pendingPreview && !state.pendingExport) resolve();
      else if (Date.now() - start > 30000) reject(new Error('Editor did not become idle'));
      else setTimeout(check, 30);
    };
    check();
  });
}
window.VintageStudio = Object.freeze({ loadCanvas, snapshot, whenIdle, filters: presets });
refreshRecipes(); showFilters(); syncUI(); setupWorker();
loadDemo();
