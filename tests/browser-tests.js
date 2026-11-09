'use strict';

// Browser integration tests against the real app. Serve this file and index.html
// from the same origin; no dependencies or production download are required.
const frame = document.getElementById('appFrame');
const summary = document.getElementById('summary');
const results = document.getElementById('results');
const failureLog = document.getElementById('failures');
const storageKeys = ['vintage-studio.favorites.v1', 'vintage-studio.recipes.v1'];
const storageBackup = new Map();
const reports = [];
const runtimeErrors = [];
let app;
let doc;
let main;
let fixture;
let originalPixels;
let storagePrepared = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const element = (id) => {
  const found = doc.getElementById(id);
  assert(found, '누락된 요소: #' + id);
  return found;
};
const snapshot = () => app.VintageStudio.snapshot();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, description, timeout = 15000) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error('시간 초과: ' + description);
    await sleep(25);
  }
}

async function idle() {
  await app.VintageStudio.whenIdle();
  await sleep(40);
  await app.VintageStudio.whenIdle();
}

function pixels(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
}

function equalPixels(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function checksum(data) {
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 1) hash = Math.imul(hash ^ data[index], 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function editState(value = snapshot()) {
  return JSON.stringify({ filter: value.filter, strength: value.strength, edits: value.edits });
}

function makeFixture(width = 320, height = 240, alternate = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, alternate ? '#efbd7e' : '#89c9e2');
  gradient.addColorStop(.5, '#d8e3cc');
  gradient.addColorStop(1, '#253c47');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#d9a47f';
  context.beginPath();
  context.ellipse(width * .28, height * .38, width * .15, height * .22, 0, 0, Math.PI * 2);
  context.fill();
  ['#eee9df', '#b7b8b0', '#191e23', '#ad533d', '#c8a256', '#4c7655', '#369da6', '#41648f'].forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect(index * width / 8, height * .72, width / 8 + 1, height * .28);
  });
  const gray = context.createLinearGradient(width * .55, 0, width * .94, 0);
  gray.addColorStop(0, '#000');
  gray.addColorStop(1, '#fff');
  context.fillStyle = gray;
  context.fillRect(width * .55, height * .13, width * .39, height * .38);
  return canvas;
}

function asBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob returned null')), type, quality));
}

function chooseFile(file) {
  const transfer = new app.DataTransfer();
  transfer.items.add(file);
  const input = element('fileInput');
  input.files = transfer.files;
  input.dispatchEvent(new app.Event('change', { bubbles: true }));
}

async function uploadCanvas(canvas, name = 'fixture.png') {
  const blob = await asBlob(canvas);
  chooseFile(new app.File([blob], name, { type: 'image/png' }));
  await waitFor(() => snapshot().sourceWidth === canvas.width && snapshot().sourceHeight === canvas.height && !snapshot().loading, '사진 파일 디코딩');
  await idle();
}

async function click(id) {
  assert(!element(id).disabled, '#' + id + ' 버튼이 비활성화됨');
  element(id).click();
  await idle();
}

async function category(id) {
  element('filterTab').click();
  const button = doc.querySelector('[data-category="' + id + '"]');
  assert(button, '카테고리 없음: ' + id);
  button.click();
  await idle();
}

function visibleCards() {
  return [...doc.querySelectorAll('[data-filter]')].filter((card) => !card.hidden && app.getComputedStyle(card).display !== 'none');
}

async function selectFilter(id) {
  const card = doc.querySelector('[data-filter="' + id + '"]');
  assert(card, '필터 카드 없음: ' + id);
  card.click();
  await idle();
  assert(snapshot().filter === id, '선택한 필터 상태 불일치: ' + id);
  assert(card.getAttribute('aria-pressed') === 'true', '선택한 카드 접근성 상태 누락: ' + id);
}

async function inputValue(id, value, commit = true) {
  const input = element(id);
  input.value = String(value);
  input.dispatchEvent(new app.Event('input', { bubbles: true }));
  if (commit) input.dispatchEvent(new app.Event('change', { bubbles: true }));
  await idle();
}

async function selectValue(id, value) {
  element(id).value = String(value);
  element(id).dispatchEvent(new app.Event('input', { bubbles: true }));
  element(id).dispatchEvent(new app.Event('change', { bubbles: true }));
  await idle();
}

async function test(name, run) {
  const start = performance.now();
  let passed = true;
  let detail = '';
  try { detail = await run() || ''; }
  catch (error) { passed = false; detail = error.stack || String(error); }
  const report = { name, passed, detail, milliseconds: Math.round(performance.now() - start) };
  reports.push(report);
  const item = document.createElement('li');
  item.className = passed ? 'pass' : 'fail';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = passed ? 'PASS' : 'FAIL';
  item.append(label, document.createTextNode(name + ' · ' + report.milliseconds + 'ms'));
  if (detail) {
    const note = document.createElement('div');
    note.className = 'detail';
    note.textContent = detail;
    item.append(note);
  }
  results.append(item);
  const failed = reports.filter((entry) => !entry.passed).length;
  summary.textContent = '진행 중 · ' + reports.length + '개 / PASS ' + (reports.length - failed) + ' / FAIL ' + failed;
}

async function checkViewport(width, height) {
  frame.style.width = width + 'px';
  frame.style.height = height + 'px';
  await sleep(150);
  const root = doc.documentElement;
  assert(root.scrollWidth <= root.clientWidth + 1, '가로 넘침: ' + root.scrollWidth + ' > ' + root.clientWidth);
  for (const id of ['uploadBtn', 'exportBtn', 'compareBtn', 'filterTab', 'adjustTab']) {
    const bounds = element(id).getBoundingClientRect();
    assert(bounds.width > 0 && bounds.height > 0, id + ' 표시 영역이 없음');
    assert(bounds.left >= -1 && bounds.right <= width + 1, id + ' 가로 화면 바깥');
  }
  const imageBounds = main.getBoundingClientRect();
  assert(imageBounds.width > 40 && imageBounds.height > 40, '사진 미리보기가 보이지 않음');
  const imageStyle = app.getComputedStyle(main);
  const displayedRatio = imageBounds.width / imageBounds.height;
  assert(imageStyle.objectFit === 'contain' || Math.abs(displayedRatio - main.width / main.height) < .025, '미리보기 사진 비율이 변형됨');
  element('adjustTab').click();
  await idle();
  element('exposureInput').scrollIntoView({ block: 'center' });
  await sleep(80);
  const range = element('exposureInput').getBoundingClientRect();
  assert(range.width > 70 && range.height > 0, '모바일 노출 슬라이더 사용 불가');
  assert(range.left >= -1 && range.right <= width + 1, '슬라이더 가로 넘침');
  assert(range.top >= -1 && range.bottom <= height + 1, '스크롤 후 슬라이더 접근 불가');
  element('filterTab').click();
  app.scrollTo(0, 0);
  await idle();
  return width + ' × ' + height + ' · 가로 넘침 없음 · 사진 비율 유지 · 조정 컨트롤 접근 가능';
}

function restoreStorage() {
  if (!storagePrepared) return;
  for (const [key, value] of storageBackup) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  storagePrepared = false;
}

async function runSuite() {
  app = frame.contentWindow;
  doc = frame.contentDocument;
  app.addEventListener('error', (event) => runtimeErrors.push(event.message));
  app.addEventListener('unhandledrejection', (event) => runtimeErrors.push(String(event.reason)));
  await waitFor(() => app.VintageStudio, 'VintageStudio 초기화');
  await idle();
  main = element('mainCanvas');
  fixture = makeFixture();

  await test('첫 화면 샘플 · 로컬 데이터 URL · 캔버스 안전성', () => {
    assert(app.VINTAGE_DEMO_IMAGE.startsWith('data:image/jpeg;base64,'), '샘플에 로컬 데이터 URL을 사용하지 않음');
    assert(snapshot().sourceWidth > 0 && snapshot().sourceHeight > 0, '샘플 자동 로드 실패');
    assert(!main.hidden && !element('exportBtn').disabled, '샘플 편집 및 내보내기 불가');
    assert(pixels(main).some((value, index) => index % 4 !== 3 && value > 0), '샘플 사진이 비어 있음');
    return snapshot().sourceWidth + ' × ' + snapshot().sourceHeight + ' · 캔버스 픽셀 읽기 성공';
  });

  await test('원본 + 44가지 필터 · 고유 ID · 실제 썸네일', async () => {
    await category('all');
    const presets = app.VintageFilters.presets;
    assert(presets.length === 45 && new Set(presets.map((preset) => preset.id)).size === 45, '필터 목록 또는 ID 불일치');
    assert(visibleCards().length === 45, '전체 필터 카드 수 불일치: ' + visibleCards().length);
    await waitFor(() => [...doc.querySelectorAll('.filter-preview')].every((canvas) => pixels(canvas).some((value, index) => index % 4 === 3 && value > 0)), '전체 필터 썸네일 렌더링');
    return '45개 카드와 이미지 썸네일';
  });

  await test('추천 · 전체 · 검색 · 빈 검색 결과', async () => {
    await category('recommended');
    assert(visibleCards().length >= 3 && visibleCards().length < 45, '추천 필터 목록 크기가 올바르지 않음');
    await category('all');
    await inputValue('filterSearch', '1995', false);
    assert(visibleCards().some((card) => card.dataset.filter === 'minilab1995'), '필터 이름 검색 실패');
    assert(visibleCards().length < 45, '검색으로 필터가 좁혀지지 않음');
    await inputValue('filterSearch', '__NO_SUCH_LOOK_000__', false);
    assert(visibleCards().length === 0 && !element('emptyFilters').hidden, '빈 검색 결과 안내 누락');
    await inputValue('filterSearch', '', false);
    assert(visibleCards().length === 45, '검색 해제 후 전체 목록 복원 실패');
  });

  await test('새로운 룩 12종 · 디카 컬렉션 · 한글 검색', async () => {
    await category('new');
    assert(visibleCards().length === 12, '새 컬렉션의 필터 수 불일치');
    await inputValue('filterSearch', '폴더폰', false);
    assert(visibleCards().length === 1 && visibleCards()[0].dataset.filter === 'keitai2006', '신규 필터 검색 실패');
    await inputValue('filterSearch', '', false);
    await category('digital');
    assert(visibleCards().some((card) => card.dataset.filter === 'ccd2004'), '신규 디카 필터가 기존 컬렉션에서 누락됨');
    await category('all');
  });

  await test('즐겨찾기 토글 · 카테고리 · 로컬 저장', async () => {
    await selectFilter('gold200');
    await click('favoriteBtn');
    const stored = JSON.parse(app.localStorage.getItem(storageKeys[0]));
    assert(Array.isArray(stored) && stored.includes('gold200'), '즐겨찾기가 저장되지 않음');
    await category('favorites');
    assert(visibleCards().some((card) => card.dataset.filter === 'gold200'), '즐겨찾기 목록에 필터 없음');
    assert(!visibleCards().some((card) => card.dataset.filter === 'daily400'), '저장하지 않은 필터가 즐겨찾기에 표시됨');
    await category('all');
  });

  await test('실제 파일 input → 이미지 디코딩 → 원본 픽셀 보존', async () => {
    await uploadCanvas(fixture);
    await category('all');
    await selectFilter('original');
    assert(main.width === 320 && main.height === 240, '업로드한 사진 크기 불일치');
    assert(element('fileInput').value === '', '동일 파일 재선택을 위한 input 초기화 누락');
    assert(equalPixels(pixels(main), pixels(fixture)), 'PNG 원본 픽셀이 달라짐');
    originalPixels = pixels(main);
    return '320 × 240 PNG · 실제 File/DataTransfer 경로';
  });

  await test('44가지 필터 모두 UI 적용 · 서로 다른 결과 · 효과 누적 없음', async () => {
    const hashes = new Map();
    for (const preset of app.VintageFilters.presets) {
      await selectFilter(preset.id);
      const hash = checksum(pixels(main));
      assert(![...hashes.values()].includes(hash), '동일한 결과를 내는 필터: ' + preset.id);
      hashes.set(preset.id, hash);
    }
    await selectFilter('album1991');
    assert(checksum(pixels(main)) === hashes.get('album1991'), '같은 필터를 다시 선택했을 때 결과가 변함');
    await selectFilter('original');
    assert(equalPixels(pixels(main), originalPixels), '필터를 바꾸는 동안 원본이 손상됨');
    return hashes.size + '개 고유 결과 · 원본 복원 일치';
  });

  await test('필름 강도 0% · 50% · 100%', async () => {
    await selectFilter('gold200');
    await inputValue('strengthInput', 0);
    assert(equalPixels(pixels(main), originalPixels), '강도 0%가 원본과 다름');
    await inputValue('strengthInput', 100);
    const full = pixels(main);
    assert(!equalPixels(full, originalPixels), '강도 100% 효과가 없음');
    await inputValue('strengthInput', 50);
    const halfway = pixels(main);
    for (let index = 0; index < halfway.length; index += 1) {
      assert(Math.abs(halfway[index] - (originalPixels[index] + full[index]) / 2) <= 1, '50% 강도 혼합이 잘못됨');
    }
    assert(element('strengthValue').textContent.includes('50') || String(element('strengthValue').value).includes('50'), '강도 표시 갱신 실패');
  });

  await test('필터 변경 실행 취소 · 다시 실행', async () => {
    await selectFilter('daily400');
    const before = editState();
    await selectFilter('gold200');
    const after = editState();
    await click('undoBtn');
    assert(editState() === before, '필터 실행 취소가 이전 설정을 복원하지 않음');
    await click('redoBtn');
    assert(editState() === after, '필터 다시 실행이 설정을 복원하지 않음');
  });

  await test('노출 · 색온도 조정과 슬라이더 드래그 단위 기록', async () => {
    await click('adjustTab');
    const before = editState();
    const beforePixels = pixels(main);
    await inputValue('exposureInput', 10, false);
    await inputValue('exposureInput', 23, false);
    await inputValue('exposureInput', 32);
    assert(snapshot().edits.exposure === 32, '노출 값 갱신 실패');
    assert(!equalPixels(beforePixels, pixels(main)), '노출이 실제 사진을 변경하지 않음');
    await click('undoBtn');
    assert(editState() === before, '슬라이더 드래그가 한 번의 실행 취소로 복원되지 않음');
    await click('redoBtn');
    assert(snapshot().edits.exposure === 32, '노출 다시 실행 실패');
    const exposed = pixels(main);
    await inputValue('temperatureInput', 35);
    assert(snapshot().edits.temperature === 35 && !equalPixels(exposed, pixels(main)), '색온도 적용 실패');
  });

  await test('필름 디테일 · 질감/번짐 분리 · 피부색 보호 · 하이라이트', async () => {
    const filterBefore = snapshot().filter;
    await selectFilter('warm-mist');
    await inputValue('textureInput', 0);
    await inputValue('bloomInput', 130);
    await inputValue('halationInput', 25);
    await inputValue('skinProtectInput', 85);
    await inputValue('highlightsInput', -40);
    await inputValue('shadowsInput', 25);
    const edits = snapshot().edits;
    assert(edits.texture === 0 && edits.bloom === 130 && edits.halation === 25 && edits.skinProtect === 85, '필름 디테일 설정 전달 실패');
    assert(edits.highlights === -40 && edits.shadows === 25, '명도 영역 조절 전달 실패');
    await selectFilter('silver-flash');
    assert(element('skinProtectInput').disabled, '흑백 필터의 피부색 보호가 비활성화되지 않음');
    await selectFilter(filterBefore);
  });

  await test('분할 전후 비교 · 위치 이동 · 편집 결과 보존', async () => {
    const edited = pixels(main);
    await click('compareBtn');
    assert(!element('comparisonLayer').hidden && !element('compareControl').hidden, '분할 비교 표시 실패');
    assert(element('compareBtn').getAttribute('aria-pressed') === 'true', '비교 버튼 상태 누락');
    assert(equalPixels(pixels(element('originalCanvas')), originalPixels), '비교 화면에 원본이 표시되지 않음');
    const beforeStyle = element('comparisonLayer').getAttribute('style') + element('comparisonDivider').getAttribute('style');
    await inputValue('comparePosition', 27, false);
    const afterStyle = element('comparisonLayer').getAttribute('style') + element('comparisonDivider').getAttribute('style');
    assert(beforeStyle !== afterStyle, '비교 슬라이더가 분할 위치를 바꾸지 않음');
    assert(equalPixels(pixels(main), edited), '비교 중 편집된 캔버스가 변경됨');
    await click('compareBtn');
    assert(element('comparisonLayer').hidden && element('compareControl').hidden, '비교 종료 실패');
  });

  await test('4:5 가운데 크롭 · 90도 회전 · 비교 사진 기하 일치', async () => {
    await selectValue('aspectInput', '4:5');
    assert(main.width === 192 && main.height === 240, '4:5 크롭 결과 불일치: ' + main.width + '×' + main.height);
    await click('rotateBtn');
    assert(snapshot().edits.rotate === 90, '회전 상태 변경 실패');
    assert(main.width === 240 && main.height === 300, '회전 후 4:5 크롭 불일치');
    await click('compareBtn');
    assert(element('originalCanvas').width === main.width && element('originalCanvas').height === main.height, '원본/보정 비교 크기 불일치');
    await click('compareBtn');
    await selectValue('aspectInput', 'original');
    assert(main.width === 240 && main.height === 320, '원본 비율 회전 결과 불일치');
  });

  await test('초기화와 초기화 실행 취소', async () => {
    const before = editState();
    await click('resetBtn');
    assert(snapshot().filter === 'original', '초기화가 원본 필터를 복원하지 않음');
    assert(JSON.stringify(snapshot().edits) === JSON.stringify(app.VintageEditorCore.defaults), '초기화 후 수동 조정 잔존');
    assert(equalPixels(pixels(main), originalPixels), '초기화 후 원본 픽셀 불일치');
    await click('undoBtn');
    assert(editState() === before, '초기화 실행 취소 실패');
  });

  await test('레시피 저장 · 적용 · 삭제', async () => {
    const expected = editState();
    await click('saveRecipeBtn');
    assert(element('recipeDialog').open, '레시피 이름 대화상자 열기 실패');
    element('recipeName').value = 'QA 여름의 기억';
    await click('confirmRecipeBtn');
    assert(!element('recipeDialog').open, '레시피 저장 후 대화상자가 열려 있음');
    const option = [...element('recipeSelect').options].find((item) => item.textContent.includes('QA 여름의 기억'));
    assert(option && option.value, '저장한 레시피를 선택할 수 없음');
    assert(app.localStorage.getItem(storageKeys[1]).includes('QA 여름의 기억'), '레시피 로컬 저장 실패');
    await click('resetBtn');
    await selectValue('recipeSelect', option.value);
    assert(editState() === expected, '레시피 적용이 필터/강도/조정을 복원하지 않음');
    await click('deleteRecipeBtn');
    assert(![...element('recipeSelect').options].some((item) => item.value === option.value), '레시피 삭제 실패');
  });

  await test('내보내기 설정 · JPEG/PNG · 크기 안내 · 취소', async () => {
    const before = editState();
    await click('exportBtn');
    assert(element('exportDialog').open, '내보내기 대화상자 열기 실패');
    await selectValue('exportSize', 4096);
    await selectValue('exportFormat', 'image/png');
    const expectedSize = app.VintageEditorCore.orientedSize(fixture, snapshot().edits, 4096);
    const description = element('exportSummary').textContent;
    assert(description.includes(String(expectedSize.width)) && description.includes(String(expectedSize.height)), '실제 내보내기 크기 안내 불일치: ' + description);
    assert(element('qualityRow').hidden || app.getComputedStyle(element('qualityRow')).display === 'none', 'PNG에 JPEG 품질 옵션이 노출됨');
    await selectValue('exportFormat', 'image/jpeg');
    assert(!element('qualityRow').hidden, 'JPEG 품질 옵션 누락');
    await inputValue('exportQuality', 88, false);
    assert(element('qualityValue').textContent.includes('88') || String(element('qualityValue').value).includes('88'), 'JPEG 품질 표시 갱신 실패');
    await click('cancelExportBtn');
    assert(!element('exportDialog').open && editState() === before, '내보내기 취소가 편집 상태를 변경함');
    return description + ' · 실제 다운로드는 실행하지 않음';
  });

  await test('실제 PNG/JPEG 인코딩과 원본보다 확대하지 않는 출력', async () => {
    const value = snapshot();
    const output = app.VintageEditorCore.render(fixture, { filter: value.filter, strength: value.strength, edits: value.edits, maxDimension: 4096, seed: 42 });
    assert(Math.max(output.width, output.height) <= 320, '작은 원본을 불필요하게 확대함');
    const png = await asBlob(output, 'image/png');
    const jpeg = await asBlob(output, 'image/jpeg', .88);
    const pngBytes = new Uint8Array(await png.arrayBuffer());
    const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
    assert(png.type === 'image/png' && pngBytes[0] === 137 && pngBytes[1] === 80 && pngBytes[2] === 78, '유효한 PNG가 아님');
    assert(jpeg.type === 'image/jpeg' && jpegBytes[0] === 255 && jpegBytes[1] === 216, '유효한 JPEG가 아님');
    return output.width + ' × ' + output.height + ' · PNG ' + png.size + ' B · JPEG ' + jpeg.size + ' B';
  });

  await test('잘못된 파일 오류 · 기존 사진과 편집 상태 보존', async () => {
    const before = editState();
    const beforePixels = pixels(main);
    chooseFile(new app.File(['this is not an image'], 'broken.png', { type: 'image/png' }));
    await waitFor(() => !snapshot().loading && !element('statusMessage').hidden, '잘못된 파일 안내');
    await idle();
    assert(editState() === before && equalPixels(pixels(main), beforePixels), '잘못된 파일이 기존 작업을 지움');
    assert(!element('uploadBtn').disabled && !element('exportBtn').disabled, '오류 후 앱이 잠김');
  });

  await test('새 사진으로 교체 · 편집 기록 초기화 · 즐겨찾기 유지', async () => {
    await uploadCanvas(makeFixture(300, 200, true), 'replacement.png');
    assert(snapshot().historyIndex === 0 && snapshot().historyLength === 1, '다른 사진의 편집 기록이 남음');
    assert(snapshot().filter === 'original', '새 사진에 이전 필터가 남음');
    assert(JSON.stringify(snapshot().edits) === JSON.stringify(app.VintageEditorCore.defaults), '새 사진에 이전 조정이 남음');
    assert(element('undoBtn').disabled && element('redoBtn').disabled, '새 사진에서 이전 기록으로 이동 가능');
    assert(JSON.parse(app.localStorage.getItem(storageKeys[0])).includes('gold200'), '사진 교체가 즐겨찾기를 지움');
    assert(main.width === 300 && main.height === 200 && element('statusMessage').hidden, '오류 후 새 사진 복구 실패');
  });

  await test('데스크톱 960 × 820 레이아웃', () => checkViewport(960, 820));
  await test('모바일 390 × 844 레이아웃', () => checkViewport(390, 844));
  await test('작은 모바일 360 × 740 레이아웃', () => checkViewport(360, 740));

  await test('브라우저 예외와 비동기 거절 없음', () => {
    assert(runtimeErrors.length === 0, runtimeErrors.join('\n'));
  });

  await category('all');
  await selectFilter('gold200');
  await inputValue('strengthInput', 80);
  frame.style.width = '390px';
  frame.style.height = '844px';
  app.scrollTo(0, 0);
  document.getElementById('previewNote').textContent = '실제 앱 · 390 × 844 · 골드 200 / 강도 80%. 테스트 전 즐겨찾기와 레시피는 복원되었습니다.';
}

async function start() {
  try {
    for (const key of storageKeys) storageBackup.set(key, localStorage.getItem(key));
    storagePrepared = true;
    for (const key of storageKeys) localStorage.removeItem(key);
    const loaded = new Promise((resolve, reject) => {
      const onLoad = () => {
        if (!frame.contentWindow.location.pathname.endsWith('/index.html')) return;
        frame.removeEventListener('load', onLoad);
        resolve();
      };
      frame.addEventListener('load', onLoad);
      frame.addEventListener('error', reject, { once: true });
    });
    frame.src = '../index.html';
    await loaded;
    await runSuite();
  } catch (error) {
    await test('테스트 시작 또는 완료', () => { throw error; });
  } finally {
    restoreStorage();
    const failed = reports.filter((entry) => !entry.passed);
    summary.className = failed.length ? 'fail' : 'pass';
    summary.textContent = (failed.length ? '실패' : '완료') + ' · ' + reports.length + '개 / PASS ' + (reports.length - failed.length) + ' / FAIL ' + failed.length;
    failureLog.hidden = failed.length === 0;
    failureLog.textContent = failed.map((entry) => entry.name + '\n' + entry.detail).join('\n\n');
    // A browser driver can read a structured result without scraping labels.
    window.VintageStudioTestResults = { complete: true, passed: reports.length - failed.length, failed: failed.length, reports, runtimeErrors };
    document.documentElement.dataset.testStatus = failed.length ? 'fail' : 'pass';
  }
}

window.addEventListener('pagehide', restoreStorage);
start();
