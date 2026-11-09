'use strict';

// A browser-only integration harness. Open this page through the same local
// server as index.html so the iframe is same-origin. No production state is exposed.
const frame = document.getElementById('appFrame');
const summary = document.getElementById('summary');
const results = document.getElementById('results');
const failureLog = document.getElementById('failures');
const reports = [];
const runtimeErrors = [];
let app;
let doc;
let main;
let initialPixels;
let fixture;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pixels(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height).data;
}

function equalPixels(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function checksum(data) {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 1) hash = Math.imul(hash ^ data[i], 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function nextFrame() {
  return new Promise((resolve) => app.requestAnimationFrame(resolve));
}

async function settle() {
  await nextFrame();
  await nextFrame();
}

async function waitFor(predicate, label, timeout = 8000) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error('시간 초과: ' + label);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await settle();
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeFixture(width = 320, height = 240, alternate = false) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  const sky = context.createLinearGradient(0, 0, width, height);
  sky.addColorStop(0, alternate ? '#f2d2b0' : '#86c9e0');
  sky.addColorStop(0.52, '#d9e1ca');
  sky.addColorStop(1, '#344d58');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#d9a47f';
  context.beginPath();
  context.ellipse(width * 0.28, height * 0.38, width * 0.15, height * 0.22, 0, 0, Math.PI * 2);
  context.fill();
  const colors = ['#eee9df', '#b7b8b0', '#191e23', '#ad533d', '#c8a256', '#4c7655', '#369da6', '#41648f'];
  colors.forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect(index * width / colors.length, height * 0.72, width / colors.length + 1, height * 0.28);
  });
  const gray = context.createLinearGradient(width * 0.55, 0, width * 0.94, 0);
  gray.addColorStop(0, '#000');
  gray.addColorStop(1, '#fff');
  context.fillStyle = gray;
  context.fillRect(width * 0.55, height * 0.13, width * 0.39, height * 0.38);
  return canvas;
}

function asBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob returned null')), type, quality);
  });
}

function chooseFile(file) {
  const transfer = new app.DataTransfer();
  transfer.items.add(file);
  const input = doc.getElementById('fileInput');
  input.files = transfer.files;
  input.dispatchEvent(new app.Event('change', { bubbles: true }));
}

async function uploadCanvas(canvas, name = 'fixture.png') {
  const blob = await asBlob(canvas);
  chooseFile(new app.File([blob], name, { type: 'image/png' }));
  await waitFor(() => !main.hidden && !doc.getElementById('changeImageBtn').disabled
    && doc.getElementById('statusMessage').hidden, '이미지 파일 불러오기');
}

async function selectFilter(id) {
  const button = doc.querySelector('[data-filter="' + id + '"]');
  assert(button, '필터 버튼 누락: ' + id);
  button.click();
  await settle();
  assert(button.getAttribute('aria-pressed') === 'true', '필터 선택 상태가 갱신되지 않음: ' + id);
}

async function setStrength(value) {
  const input = doc.getElementById('strengthInput');
  input.value = String(value);
  input.dispatchEvent(new app.Event('input', { bubbles: true }));
  await settle();
}

function chooseCategory(category) {
  const button = doc.querySelector('[data-category="' + category + '"]');
  assert(button, '카테고리 버튼 누락: ' + category);
  button.click();
}

async function test(name, run) {
  const started = performance.now();
  let detail;
  let passed = true;
  try {
    detail = await run();
  } catch (error) {
    passed = false;
    detail = error.stack || String(error);
  }
  const report = { name, passed, detail: detail || '', milliseconds: Math.round(performance.now() - started) };
  reports.push(report);
  const item = document.createElement('li');
  item.className = passed ? 'pass' : 'fail';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = passed ? 'PASS' : 'FAIL';
  item.append(label, document.createTextNode(name + ' · ' + report.milliseconds + 'ms'));
  if (detail) {
    const text = document.createElement('div');
    text.className = 'detail';
    text.textContent = detail;
    item.appendChild(text);
  }
  results.appendChild(item);
  const failures = reports.filter((entry) => !entry.passed).length;
  summary.textContent = '진행 중 · ' + reports.length + '건 / PASS ' + (reports.length - failures) + ' / FAIL ' + failures;
}

async function checkViewport(width, height) {
  frame.style.width = width + 'px';
  frame.style.height = height + 'px';
  await settle();
  const root = doc.documentElement;
  assert(root.scrollWidth <= root.clientWidth + 1, '페이지 가로 넘침: ' + root.scrollWidth + ' > ' + root.clientWidth);
  for (const id of ['changeImageBtn', 'downloadBtn', 'strengthInput', 'compareBtn']) {
    const bounds = doc.getElementById(id).getBoundingClientRect();
    assert(bounds.width > 0 && bounds.height > 0, id + '가 숨겨짐');
    assert(bounds.left >= -1 && bounds.right <= width + 1, id + '가 가로 화면 밖으로 나감');
    assert(bounds.top >= 0 && bounds.bottom <= height + 1, id + '가 세로 화면 밖으로 나감: ' + bounds.bottom);
  }
  const editor = doc.querySelector('.editor').getBoundingClientRect();
  assert(editor.height >= 120, '이미지 편집 영역이 너무 작음: ' + editor.height);
  assert(app.getComputedStyle(main).objectFit === 'contain', '이미지 비율 유지 스타일 누락');
  return width + ' × ' + height + ', 이미지 영역 ' + Math.round(editor.height) + 'px, 주요 컨트롤 화면 안';
}

async function runSuite() {
  app = frame.contentWindow;
  doc = frame.contentDocument;
  main = doc.getElementById('mainCanvas');
  app.addEventListener('error', (event) => runtimeErrors.push(event.message));
  app.addEventListener('unhandledrejection', (event) => runtimeErrors.push(String(event.reason)));
  fixture = makeFixture();

  await test('원본 + 32가지 필터와 고유 ID', () => {
    assert(app.VintageFilters, '필터 엔진이 로드되지 않음');
    const presets = app.VintageFilters.presets;
    assert(presets.length === 33, '프리셋 수: ' + presets.length);
    assert(new Set(presets.map((preset) => preset.id)).size === 33, '중복 ID');
    assert(doc.querySelectorAll('[data-filter]').length === 33, 'UI 카드 수 불일치');
    assert(doc.getElementById('filterCount').textContent === '32 LOOKS', '필터 수 안내 불일치');
    return presets.map((preset) => preset.name).join(', ');
  });

  await test('초기 업로드 안내와 숨김 상태', () => {
    assert(main.hidden && doc.getElementById('controls').hidden, '업로드 전 편집 UI가 보임');
    assert(!doc.getElementById('placeholder').hidden, '업로드 안내가 숨겨짐');
    assert(doc.getElementById('downloadBtn').disabled, '업로드 전 저장이 활성화됨');
  });

  await test('File → input change → 이미지 디코딩 → 캔버스', async () => {
    await uploadCanvas(fixture);
    assert(main.width === 320 && main.height === 240, '이미지 크기 불일치');
    assert(doc.getElementById('placeholder').hidden && !doc.getElementById('controls').hidden, '업로드 후 화면 전환 실패');
    assert(doc.getElementById('fileInput').value === '', '동일 파일 재선택을 위한 input 초기화 누락');
    initialPixels = pixels(main);
    assert(equalPixels(initialPixels, pixels(fixture)), 'PNG 원본 로딩에서 픽셀이 바뀜');
    return '320 × 240 PNG, 원본 픽셀 일치';
  });

  const presetHashes = new Map();
  await test('모든 필터의 실제 UI 적용과 서로 다른 결과', async () => {
    chooseCategory('all');
    for (const preset of app.VintageFilters.presets) {
      await selectFilter(preset.id);
      assert(doc.getElementById('filterName').textContent === preset.name, '선택한 필터 이름 불일치');
      const hash = checksum(pixels(main));
      assert(![...presetHashes.values()].includes(hash), '다른 필터와 결과가 동일: ' + preset.name);
      presetHashes.set(preset.id, hash);
    }
    return [...presetHashes].map(([id, hash]) => id + ': ' + hash).join(' · ');
  });

  await test('재선택 결정성과 원본 복원 — 효과 누적 없음', async () => {
    for (const preset of app.VintageFilters.presets) {
      await selectFilter(preset.id);
      assert(checksum(pixels(main)) === presetHashes.get(preset.id), '재선택 결과가 달라짐: ' + preset.id);
    }
    await selectFilter('original');
    assert(equalPixels(pixels(main), initialPixels), '필터 변경 후 원본이 손상됨');
    return '33개 선택지 재선택 결과 동일, 원본 픽셀 보존';
  });

  await test('강도 0%·50%·100%와 슬라이더 표시', async () => {
    await selectFilter('gold200');
    await setStrength(0);
    assert(equalPixels(pixels(main), initialPixels), '강도 0%가 원본과 다름');
    await setStrength(100);
    const full = pixels(main);
    assert(!equalPixels(full, initialPixels), '강도 100% 효과가 없음');
    await setStrength(50);
    const halfway = pixels(main);
    assert(!equalPixels(halfway, full) && !equalPixels(halfway, initialPixels), '중간 강도 결과가 끝점과 같음');
    for (let i = 0; i < halfway.length; i += 1) {
      assert(Math.abs(halfway[i] - (initialPixels[i] + full[i]) / 2) <= 1, '중간 강도 혼합이 예상 범위를 벗어남');
    }
    assert(doc.getElementById('strengthValue').value === '50%', '강도 표시 불일치');
    await setStrength(80);
  });

  await test('원본 비교 토글 중에도 선택한 필터 결과 저장', async () => {
    const selected = pixels(main);
    doc.getElementById('compareBtn').click();
    await settle();
    assert(equalPixels(pixels(main), initialPixels), '비교 모드가 원본을 표시하지 않음');
    assert(doc.getElementById('compareBtn').getAttribute('aria-pressed') === 'true', '비교 상태 표시 누락');
    assert(equalPixels(pixels(app.createExportCanvas()), selected), '비교 중 저장 결과가 선택한 필터와 다름');
    doc.getElementById('compareBtn').click();
    await settle();
    assert(equalPixels(pixels(main), selected), '비교 종료 후 선택한 필터로 복원되지 않음');
  });

  await test('신규 공간 필터 강도 변경·재선택·비교 저장', async () => {
    await selectFilter('warm-mist');
    await setStrength(100);
    const full = pixels(main);
    await setStrength(0);
    assert(equalPixels(pixels(main), initialPixels), '공간 필터 0%가 원본과 다름');
    await setStrength(45);
    const partial = pixels(main);
    for (let i = 0; i < partial.length; i += 1) {
      assert(Math.abs(partial[i] - (initialPixels[i] * 0.55 + full[i] * 0.45)) <= 1,
        '공간 필터 강도 변경 시 혼합 결과가 달라짐');
    }
    await selectFilter('red-leak');
    assert(!equalPixels(pixels(main), partial), '다른 필터에서 이전 결과가 재사용됨');
    await selectFilter('warm-mist');
    assert(equalPixels(pixels(main), partial), '공간 필터 재선택 후 결과가 달라짐');
    doc.getElementById('compareBtn').click();
    await settle();
    assert(equalPixels(pixels(main), initialPixels), '공간 필터의 원본 비교 실패');
    assert(equalPixels(pixels(app.createExportCanvas()), partial), '비교 중 공간 필터 저장 결과 불일치');
    await selectFilter('gold200');
    await setStrength(80);
  });

  await test('90년대·빈티지·레트로와 기존 카테고리 필터링', async () => {
    const presets = app.VintageFilters.presets;
    for (const category of ['film', 'digital', 'mono']) {
      chooseCategory(category);
      const visible = [...doc.querySelectorAll('[data-filter]')].filter((button) => !button.hidden).map((button) => button.dataset.filter);
      const expected = presets.filter((preset) => preset.id === 'original' || preset.category === category
        || (preset.categories || []).includes(category)).map((preset) => preset.id);
      assert(JSON.stringify(visible) === JSON.stringify(expected), category + ' 카테고리 목록 불일치');
      assert(visible.length < presets.length, category + ' 목록이 줄지 않음');
    }
    const analogGroups = {
      nineties: ['album1991', 'school1994', 'summer1996', 'flash1998', 'minilab1995', 'camcorder1999'],
      vintage: ['expired-roll', 'sunfaded-slide', 'amber-print', 'rose-print', 'silver-print', 'sepia-archive'],
      retro: ['half-frame', 'toy-lens', 'red-leak', 'warm-mist'],
    };
    for (const [category, expectedIds] of Object.entries(analogGroups)) {
      chooseCategory(category);
      const visible = [...doc.querySelectorAll('[data-filter]')].filter((button) => !button.hidden).map((button) => button.dataset.filter);
      assert(JSON.stringify(visible) === JSON.stringify(['original', ...expectedIds]), category + ' 신규 필터 목록 불일치');
    }
    chooseCategory('classic');
    const classic = [...doc.querySelectorAll('[data-filter]')].filter((button) => !button.hidden).map((button) => button.dataset.filter);
    assert(JSON.stringify(classic) === JSON.stringify(['original', 'clarendon', 'gingham', 'lark', 'moon']), '기존 필터 4종이 모두 표시되지 않음');
    chooseCategory('all');
    await settle();
  });

  await test('다른 사진 선택 시 원본·강도·카테고리 초기화', async () => {
    await selectFilter('warm-digicam');
    await setStrength(37);
    doc.getElementById('compareBtn').click();
    chooseCategory('digital');
    const replacement = makeFixture(200, 300, true);
    await uploadCanvas(replacement, 'replacement.png');
    assert(doc.querySelector('[data-filter="original"]').getAttribute('aria-pressed') === 'true', '원본으로 초기화되지 않음');
    assert(doc.getElementById('strengthInput').value === '80', '강도 기본값 초기화 실패');
    assert(doc.getElementById('strengthInput').disabled, '원본에서 강도 슬라이더 활성화');
    assert(doc.querySelector('[data-category="all"]').getAttribute('aria-pressed') === 'true', '전체 카테고리 초기화 실패');
    assert(doc.getElementById('compareBtn').getAttribute('aria-pressed') === 'false', '비교 상태가 남아있음');
    assert(equalPixels(pixels(main), pixels(replacement)), '교체한 사진이 표시되지 않음');
  });

  await test('깨진 이미지 로딩 오류 후 이전 사진·버튼 복구', async () => {
    await selectFilter('gold200');
    const before = pixels(main);
    chooseFile(new app.File(['not an image'], 'broken.jpg', { type: 'image/jpeg' }));
    await waitFor(() => doc.getElementById('statusMessage').classList.contains('error')
      && !doc.getElementById('changeImageBtn').disabled, '깨진 이미지 오류 처리');
    assert(equalPixels(before, pixels(main)), '로딩 오류가 기존 편집 사진을 훼손함');
    assert(!doc.getElementById('downloadBtn').disabled && !doc.getElementById('uploadBtn').disabled, '로딩 오류 후 버튼이 비활성화 상태');
    assert(!doc.getElementById('statusMessage').hidden, '오류 안내 누락');
  });

  await test('큰 이미지 긴 변 1440px 축소', async () => {
    app.onImageReady(makeFixture(2880, 1440));
    await settle();
    assert(main.width === 1440 && main.height === 720, '축소 결과: ' + main.width + ' × ' + main.height);
  });

  await test('극단적인 가로·세로 비율에서도 1px 이상', async () => {
    app.onImageReady(makeFixture(2880, 1));
    await settle();
    assert(main.width === 1440 && main.height === 1, '가로 파노라마 높이가 0이 됨');
    app.onImageReady(makeFixture(1, 2880));
    await settle();
    assert(main.width === 1 && main.height === 1440, '세로 파노라마 너비가 0이 됨');
  });

  await test('필터 엔진의 입력 캔버스 불변성', () => {
    const source = makeFixture();
    const before = pixels(source);
    const destination = makeCanvas(source.width, source.height);
    const context = destination.getContext('2d', { willReadFrequently: true });
    for (const preset of app.VintageFilters.presets) {
      app.VintageFilters.render(context, source, preset.id, { strength: 1, seed: 123 });
      assert(equalPixels(before, pixels(source)), '입력 사진이 변경됨: ' + preset.id);
    }
  });

  await test('모든 필터의 투명·반투명 알파 보존', () => {
    const source = makeCanvas(32, 24);
    const context = source.getContext('2d');
    const data = context.createImageData(32, 24);
    const alpha = [0, 64, 128, 192, 255];
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 180;
      data.data[i + 1] = 100;
      data.data[i + 2] = 60;
      data.data[i + 3] = alpha[(i / 4) % alpha.length];
    }
    context.putImageData(data, 0, 0);
    const before = pixels(source);
    const target = makeCanvas(32, 24);
    for (const preset of app.VintageFilters.presets) {
      app.VintageFilters.render(target.getContext('2d', { willReadFrequently: true }), source, preset.id, { strength: 1, seed: 7 });
      const after = pixels(target);
      for (let i = 3; i < after.length; i += 4) assert(after[i] === before[i], '알파 변경: ' + preset.id);
    }
    return 'alpha 0 / 64 / 128 / 192 / 255, 33개 선택지 통과';
  });

  await test('JPEG 내보내기 MIME·헤더·디코딩 크기', async () => {
    await uploadCanvas(fixture);
    await selectFilter('gold200');
    await setStrength(80);
    const output = app.createExportCanvas();
    const blob = await asBlob(output, 'image/jpeg', 0.95);
    assert(blob.type === 'image/jpeg', 'JPEG MIME 불일치');
    const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    assert(header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff, 'JPEG 파일 헤더 불일치');
    const decoded = await createImageBitmap(blob);
    assert(decoded.width === 320 && decoded.height === 240, 'JPEG 디코딩 크기 불일치');
    decoded.close();
    return blob.size.toLocaleString() + ' bytes · image/jpeg · 320 × 240';
  });

  await test('360 × 640 모바일 — 넘침·컨트롤·사진 비율', () => checkViewport(360, 640));
  await test('320 × 568 작은 모바일 — 넘침·컨트롤·사진 비율', () => checkViewport(320, 568));

  await test('실행 중 JavaScript 오류 없음', () => {
    assert(runtimeErrors.length === 0, runtimeErrors.join('\n'));
  });

  // Leave a representative filtered image ready for human visual inspection.
  frame.style.width = '390px';
  frame.style.height = '844px';
  chooseCategory('all');
  await selectFilter('gold200');
  await setStrength(80);
  doc.getElementById('filterRow').scrollLeft = 0;
  await settle();
  finish();
}

function finish() {
  const failures = reports.filter((entry) => !entry.passed);
  const passed = reports.length - failures.length;
  summary.className = failures.length ? 'fail' : 'pass';
  summary.textContent = '완료 · 총 ' + reports.length + '건 · PASS ' + passed + ' · FAIL ' + failures.length;
  summary.dataset.complete = 'true';
  summary.dataset.passed = String(passed);
  summary.dataset.failed = String(failures.length);
  document.title = (failures.length ? 'FAIL' : 'PASS') + ' · Vintage Cam · ' + passed + '/' + reports.length;
  if (failures.length) {
    failureLog.hidden = false;
    failureLog.textContent = failures.map((entry) => entry.name + '\n' + entry.detail).join('\n\n');
  }
  window.browserTestResults = { complete: true, total: reports.length, passed, failed: failures.length, reports };
}

async function start() {
  try {
    await runSuite();
  } catch (error) {
    await test('테스트 실행 환경', () => { throw error; });
    finish();
  }
}

if (frame.contentDocument && frame.contentDocument.readyState === 'complete'
  && frame.contentDocument.getElementById('mainCanvas')) {
  start();
} else {
  frame.addEventListener('load', start, { once: true });
}
