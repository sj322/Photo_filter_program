'use strict';

// UI and local file handling. filters.js owns the image-processing recipes.
const { presets, render: renderFilter } = window.VintageFilters;
const $ = (id) => document.getElementById(id);
const mainCanvas = $('mainCanvas');
const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
const placeholder = $('placeholder');
const controls = $('controls');
const filterRow = $('filterRow');
const categoryRow = $('categoryRow');
const filterName = $('filterName');
const filterDescription = $('filterDescription');
const strengthInput = $('strengthInput');
const strengthValue = $('strengthValue');
const compareBtn = $('compareBtn');
const imageInfo = $('imageInfo');
const statusMessage = $('statusMessage');
const downloadBtn = $('downloadBtn');
const uploadBtn = $('uploadBtn');
const changeImageBtn = $('changeImageBtn');
const fileInput = $('fileInput');
const MAX_DIM = 1440;
const DEFAULT_STRENGTH = 80;
const state = {
  originalCanvas: null, currentFilter: 'original', category: 'all',
  strength: DEFAULT_STRENGTH, comparing: false, seed: 1,
  loadToken: 0, thumbnailToken: 0, renderFrame: 0, loading: false, saving: false,
  originalPixels: null, filterCache: null,
};
const filterButtons = new Map();

// The same catalogue drives names, previews and rendering.
for (const preset of presets) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter-btn';
  button.dataset.filter = preset.id;
  button.setAttribute('aria-label', preset.name);
  button.setAttribute('aria-pressed', String(preset.id === 'original'));
  button.title = preset.description;
  const preview = document.createElement('canvas');
  preview.className = 'filter-preview';
  preview.width = 96;
  preview.height = 112;
  preview.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'filter-label';
  label.textContent = preset.name;
  const badge = document.createElement('span');
  badge.className = 'filter-badge';
  badge.textContent = preset.badge;
  button.append(preview, label, badge);
  filterRow.appendChild(button);
  filterButtons.set(preset.id, button);
}
$('filterCount').textContent = (presets.length - 1) + ' LOOKS';
$('lookCount').textContent = String(presets.length - 1);

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.hidden = !message;
  statusMessage.classList.toggle('error', isError);
}

function updateActions() {
  uploadBtn.disabled = state.loading;
  changeImageBtn.disabled = state.loading;
  downloadBtn.disabled = !state.originalCanvas || state.loading || state.saving;
  downloadBtn.textContent = state.saving ? '저장 준비 중…' : '↓ 저장하기';
}

uploadBtn.addEventListener('click', () => fileInput.click());
changeImageBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) loadImageFile(file);
  fileInput.value = '';
});

function loadImageFile(file) {
  const token = ++state.loadToken;
  state.loading = true;
  updateActions();
  setStatus('사진을 불러오는 중이에요…');
  const url = URL.createObjectURL(file);
  const img = new Image();
  const finish = () => {
    URL.revokeObjectURL(url);
    if (token === state.loadToken) {
      state.loading = false;
      updateActions();
    }
  };
  img.onload = () => {
    try {
      if (token === state.loadToken) onImageReady(img);
    } catch (error) {
      if (token === state.loadToken) setStatus('사진을 처리할 수 없어요. 다른 사진을 선택해주세요.', true);
      console.error(error);
    } finally {
      finish();
    }
  };
  img.onerror = () => {
    if (token === state.loadToken) setStatus('사진을 열 수 없어요. JPG, PNG, WebP 등 지원되는 이미지를 선택해주세요.', true);
    finish();
  };
  img.src = url;
}

function onImageReady(img) {
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  if (!sourceWidth || !sourceHeight) throw new Error('Empty image');
  const scale = Math.min(1, MAX_DIM / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  sourceContext.imageSmoothingQuality = 'high';
  sourceContext.drawImage(img, 0, 0, width, height);
  mainCanvas.width = width;
  mainCanvas.height = height;
  state.originalCanvas = source;
  state.originalPixels = null;
  state.filterCache = null;
  state.seed = (state.seed + 7919) >>> 0;
  state.currentFilter = 'original';
  state.strength = DEFAULT_STRENGTH;
  state.comparing = false;
  strengthInput.value = String(DEFAULT_STRENGTH);
  placeholder.hidden = true;
  mainCanvas.hidden = false;
  controls.hidden = false;
  imageInfo.hidden = false;
  setCategory('all');
  updateFilterUI();
  drawCurrentImage();
  updateActions();
  setStatus('');
  generateThumbnails(source);
}

function setCategory(category) {
  state.category = category;
  categoryRow.querySelectorAll('button').forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  for (const preset of presets) {
    const matchesCategory = preset.category === category || (preset.categories || []).includes(category);
    filterButtons.get(preset.id).hidden = category !== 'all' && preset.id !== 'original' && !matchesCategory;
  }
  filterRow.scrollLeft = 0;
}
categoryRow.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (button) setCategory(button.dataset.category);
});
filterRow.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (button) applyFilter(button.dataset.filter);
});

function applyFilter(id) {
  if (!state.originalCanvas || !filterButtons.has(id)) return;
  state.currentFilter = id;
  state.comparing = false;
  updateFilterUI();
  scheduleRender();
}

function updateFilterUI() {
  const preset = presets.find((item) => item.id === state.currentFilter);
  filterName.textContent = preset.name;
  filterDescription.textContent = preset.description;
  for (const [id, button] of filterButtons) {
    const active = id === preset.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const isOriginal = preset.id === 'original';
  strengthInput.disabled = isOriginal;
  strengthValue.value = isOriginal ? '—' : state.strength + '%';
  compareBtn.disabled = isOriginal;
  compareBtn.setAttribute('aria-pressed', String(state.comparing));
  compareBtn.textContent = state.comparing ? '필터로 돌아가기' : '원본 비교';
  imageInfo.textContent = state.comparing ? '원본 비교 중' : mainCanvas.width + ' × ' + mainCanvas.height + ' · ' + preset.name;
}

strengthInput.addEventListener('input', () => {
  state.strength = Number(strengthInput.value);
  state.comparing = false;
  updateFilterUI();
  scheduleRender();
});
compareBtn.addEventListener('click', () => {
  if (state.currentFilter === 'original') return;
  state.comparing = !state.comparing;
  updateFilterUI();
  scheduleRender();
});
function scheduleRender() {
  if (state.renderFrame) cancelAnimationFrame(state.renderFrame);
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = 0;
    drawCurrentImage();
  });
}
function drawCurrentImage() {
  if (!state.originalCanvas) return;
  paintSelectedImage(ctx, state.comparing);
  mainCanvas.setAttribute('aria-label', (state.comparing ? '원본' : filterName.textContent) + ' 사진 미리보기');
}

// Spatial effects are calculated once per selection. Adjusting the intensity
// only blends pixels, so glow and grain do not need to be recalculated per frame.
// Keep just the current filter in memory, never 32 full-resolution images.
function paintSelectedImage(context, showOriginal = false) {
  const source = state.originalCanvas;
  if (showOriginal || state.currentFilter === 'original' || state.strength === 0) {
    context.clearRect(0, 0, source.width, source.height);
    context.drawImage(source, 0, 0);
    return;
  }
  if (!state.filterCache || state.filterCache.id !== state.currentFilter) {
    const working = document.createElement('canvas');
    working.width = source.width;
    working.height = source.height;
    const workingContext = working.getContext('2d', { willReadFrequently: true });
    renderFilter(workingContext, source, state.currentFilter, { strength: 1, seed: state.seed });
    state.filterCache = {
      id: state.currentFilter,
      full: workingContext.getImageData(0, 0, source.width, source.height),
      mixed: workingContext.createImageData(source.width, source.height),
      strength: null,
    };
    working.width = working.height = 1;
  }
  const cache = state.filterCache;
  if (state.strength === 100) {
    context.putImageData(cache.full, 0, 0);
    return;
  }
  if (cache.strength !== state.strength) {
    if (!state.originalPixels) {
      state.originalPixels = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    }
    const original = state.originalPixels;
    const full = cache.full.data;
    const mixed = cache.mixed.data;
    const amount = state.strength / 100;
    for (let i = 0; i < mixed.length; i += 4) {
      mixed[i] = original[i] + (full[i] - original[i]) * amount;
      mixed[i + 1] = original[i + 1] + (full[i + 1] - original[i + 1]) * amount;
      mixed[i + 2] = original[i + 2] + (full[i + 2] - original[i + 2]) * amount;
      mixed[i + 3] = original[i + 3];
    }
    cache.strength = state.strength;
  }
  context.putImageData(cache.mixed, 0, 0);
}

function generateThumbnails(source) {
  const token = ++state.thumbnailToken;
  // Only thumbnails are cropped. The exported image retains its whole frame.
  const thumbnail = document.createElement('canvas');
  thumbnail.width = 96;
  thumbnail.height = 112;
  const scale = Math.max(thumbnail.width / source.width, thumbnail.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  const thumbnailContext = thumbnail.getContext('2d');
  thumbnailContext.imageSmoothingQuality = 'high';
  thumbnailContext.drawImage(source, (96 - width) / 2, (112 - height) / 2, width, height);
  let index = 0;
  const next = () => {
    if (token !== state.thumbnailToken) return;
    const preset = presets[index++];
    const preview = filterButtons.get(preset.id).querySelector('canvas');
    renderFilter(preview.getContext('2d', { willReadFrequently: true }), thumbnail, preset.id, {
      strength: DEFAULT_STRENGTH / 100, seed: state.seed,
    });
    if (index < presets.length) requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}

// Export the selected effect even during original comparison.
// JPEG has no alpha: flatten transparency onto white explicitly.
function createExportCanvas() {
  const filtered = document.createElement('canvas');
  filtered.width = mainCanvas.width;
  filtered.height = mainCanvas.height;
  paintSelectedImage(filtered.getContext('2d', { willReadFrequently: true }));
  const output = document.createElement('canvas');
  output.width = filtered.width;
  output.height = filtered.height;
  const outputContext = output.getContext('2d');
  outputContext.fillStyle = '#fff';
  outputContext.fillRect(0, 0, output.width, output.height);
  outputContext.drawImage(filtered, 0, 0);
  return output;
}

downloadBtn.addEventListener('click', () => {
  if (!state.originalCanvas || state.loading || state.saving) return;
  state.saving = true;
  updateActions();
  const selectedFilter = state.currentFilter;
  try {
    createExportCanvas().toBlob((blob) => {
      try {
        if (!blob) throw new Error('Image export failed');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'vintage-cam_' + selectedFilter + '_' + Date.now() + '.jpg';
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setStatus('저장할 사진을 준비했어요. 브라우저의 다운로드를 확인해주세요.');
      } catch (error) {
        setStatus('사진 저장에 실패했어요. 다시 시도해주세요.', true);
        console.error(error);
      } finally {
        state.saving = false;
        updateActions();
      }
    }, 'image/jpeg', 0.95);
  } catch (error) {
    state.saving = false;
    updateActions();
    setStatus('사진 저장에 실패했어요. 다시 시도해주세요.', true);
    console.error(error);
  }
});
