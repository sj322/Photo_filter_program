'use strict';

/* =========================================================================
 * Vintage Cam - 100% 클라이언트(브라우저) 사진 필터 앱
 *
 * 서버 없이 동작하는 구조:
 *  1) 사용자가 고른 사진을 <canvas>에 그린다.
 *  2) MediaPipe Selfie Segmentation(WASM 기반 AI, CDN 로드)으로
 *     "인물"과 "배경"을 구분하는 마스크(mask) 이미지를 얻는다.
 *  3) 마스크 값을 이용해 인물/배경에 서로 다른 밝기·대비·색온도를
 *     픽셀 단위로 적용한 뒤 하나의 이미지로 합성한다. (플래시 효과)
 *  4) 빈티지 필터들은 ImageData의 RGBA 픽셀 배열을 직접 순회하며
 *     색 보정 + 필름 그레인(노이즈)을 적용하고, 비네팅은 캔버스의
 *     radial gradient + 'multiply' 합성으로 가장자리를 어둡게 만든다.
 * =========================================================================
 */

// ------------------------------------------------------------
// DOM 참조
// ------------------------------------------------------------
const canvasWrap = document.getElementById('canvasWrap');
const mainCanvas = document.getElementById('mainCanvas');
// willReadFrequently: getImageData/putImageData를 반복 호출하므로
// 브라우저에게 CPU 경로 최적화를 힌트로 알려준다.
const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });

const placeholder = document.getElementById('placeholder');
const loadingOverlay = document.getElementById('loadingOverlay');
const controls = document.getElementById('controls');
const filterRow = document.getElementById('filterRow');
const flashBtn = document.getElementById('flashBtn');
const downloadBtn = document.getElementById('downloadBtn');
const uploadBtn = document.getElementById('uploadBtn');
const changeImageBtn = document.getElementById('changeImageBtn');
const fileInput = document.getElementById('fileInput');

// 캔버스에 그릴 이미지의 최대 긴 변(px). 스마트폰 원본 사진(수천만 화소)을
// 그대로 픽셀 반복문에 넣으면 느려지므로 적당한 크기로 축소한다.
const MAX_DIM = 1440;

// 앱의 현재 상태
const state = {
  originalImageData: null, // 필터 적용 전 원본 픽셀 데이터 (모든 필터는 항상 이 데이터에서 다시 시작 = 비파괴 편집)
  maskData: null,           // MediaPipe가 계산한 인물 마스크. getImageData와 동일한 RGBA 배열 레이아웃을 가진다.
  currentFilter: 'original',
};

// ------------------------------------------------------------
// MediaPipe Selfie Segmentation 초기화
// ------------------------------------------------------------
let selfieSegmentation = null;

function initSegmentation() {
  if (typeof SelfieSegmentation === 'undefined') {
    console.warn('MediaPipe 스크립트를 불러오지 못했습니다. 네트워크/CDN 차단 여부를 확인하세요.');
    return;
  }

  selfieSegmentation = new SelfieSegmentation({
    // wasm, 모델(.tflite) 등 부가 파일도 같은 CDN 경로에서 함께 내려받는다.
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
  });

  selfieSegmentation.setOptions({
    // 0 = general 모델(전신/원거리 등 다양한 구도), 1 = landscape 모델(근접 인물, 속도 우선)
    // 인물 사진 위주의 필터 앱이므로 속도가 빠른 landscape 모델을 기본값으로 사용한다.
    modelSelection: 1,
  });
}

/**
 * 이미지(또는 캔버스)를 MediaPipe에 넣어 인물 마스크를 계산한다.
 * 반환값: Uint8ClampedArray (RGBA). 각 픽셀의 R값(0~255)이 "그 픽셀이 인물일 확률"을 의미한다.
 *         (segmentationMask는 흑백 마스크라 R=G=B이므로 R채널만 읽어도 충분하다)
 */
function computeSegmentationMask(sourceElement, width, height) {
  return new Promise((resolve, reject) => {
    if (!selfieSegmentation) {
      reject(new Error('MediaPipe가 초기화되지 않았습니다.'));
      return;
    }

    // onResults 콜백: send()가 내부적으로 추론을 마치면 이 콜백이 호출된다.
    selfieSegmentation.onResults((results) => {
      // segmentationMask는 캔버스에 그릴 수 있는 이미지 소스(마스크)이다.
      // 별도의 오프스크린 캔버스에 원본과 동일한 크기로 그려서 픽셀 값을 읽어낸다.
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.drawImage(results.segmentationMask, 0, 0, width, height);

      const maskImageData = maskCtx.getImageData(0, 0, width, height);
      resolve(maskImageData.data);
    });

    selfieSegmentation.send({ image: sourceElement }).catch(reject);
  });
}

// ------------------------------------------------------------
// 이미지 업로드 & 초기화
// ------------------------------------------------------------
uploadBtn.addEventListener('click', () => fileInput.click());
changeImageBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadImageFile(file);
  fileInput.value = ''; // 같은 파일을 다시 선택해도 change 이벤트가 발생하도록 초기화
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => onImageReady(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function onImageReady(img) {
  // 긴 변을 기준으로 MAX_DIM 이하로 축소 (비율 유지)
  let { width, height } = img;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  mainCanvas.width = width;
  mainCanvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // 모든 필터의 출발점이 되는 원본 픽셀 데이터를 저장해둔다.
  state.originalImageData = ctx.getImageData(0, 0, width, height);
  state.maskData = null;
  state.currentFilter = 'original';

  // UI 전환: 업로드 화면 숨기고 캔버스/컨트롤 노출
  placeholder.hidden = true;
  controls.hidden = false;
  downloadBtn.disabled = false;
  setActiveFilterButton('original');

  // 플래시 버튼은 마스크가 준비되기 전까지 비활성화
  flashBtn.disabled = true;
  flashBtn.classList.add('analyzing');
  flashBtn.textContent = '⚡ 분석 중...';
  loadingOverlay.hidden = false;

  try {
    // 캔버스에 이미 그려둔(=축소 완료된) 이미지를 그대로 AI 입력으로 사용한다.
    // -> 원본 대용량 사진을 다시 넣을 필요가 없고, 마스크 크기도 캔버스와 100% 일치한다.
    const maskData = await computeSegmentationMask(mainCanvas, width, height);
    state.maskData = maskData;
    flashBtn.disabled = false;
    flashBtn.classList.remove('analyzing');
    flashBtn.textContent = '⚡ 플래시';
  } catch (err) {
    console.error('인물 분석 실패:', err);
    flashBtn.textContent = '⚡ 분석 실패';
    flashBtn.classList.remove('analyzing');
  } finally {
    loadingOverlay.hidden = true;
  }
}

// ------------------------------------------------------------
// 필터 선택 UI
// ------------------------------------------------------------
filterRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn || btn.disabled) return;
  applyFilter(btn.dataset.filter);
});

function setActiveFilterButton(name) {
  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === name);
  });
}

/**
 * 필터를 적용하는 총괄 함수.
 * 항상 state.originalImageData(원본)에서 새로 복사해 시작하므로,
 * 필터를 여러 번 눌러도 화질이 누적 손상되지 않는다(비파괴 편집).
 */
function applyFilter(name) {
  if (!state.originalImageData) return;

  const { width, height } = mainCanvas;
  // Uint8ClampedArray를 복사해 원본은 그대로 보존한다.
  const imageData = new ImageData(
    new Uint8ClampedArray(state.originalImageData.data),
    width,
    height
  );

  switch (name) {
    case 'original': {
      ctx.putImageData(imageData, 0, 0);
      break;
    }

    case 'flash': {
      if (!state.maskData) return; // 마스크 준비 전이면 무시
      const flashResult = computeFlashEffect(width, height, imageData, state.maskData);
      ctx.putImageData(flashResult, 0, 0);
      drawVignette(ctx, width, height, 0.45); // 실제 플래시 사진 특유의 가장자리 감광
      break;
    }

    case 'filmGold': {
      applyFilmGold(imageData);
      ctx.putImageData(imageData, 0, 0);
      drawVignette(ctx, width, height, 0.4);
      break;
    }

    case 'tealOrange': {
      applyTealOrange(imageData);
      ctx.putImageData(imageData, 0, 0);
      drawVignette(ctx, width, height, 0.35);
      break;
    }

    case 'retroFade': {
      applyRetroFade(imageData);
      ctx.putImageData(imageData, 0, 0);
      drawVignette(ctx, width, height, 0.6);
      break;
    }

    default:
      return;
  }

  state.currentFilter = name;
  setActiveFilterButton(name);
}

// ------------------------------------------------------------
// 1) 플래시 효과 (MediaPipe 인물/배경 분리 기반)
// ------------------------------------------------------------
/**
 * 인물 영역과 배경 영역에 서로 다른 색 보정을 적용한 뒤,
 * 마스크 값(0~1)을 가중치로 사용해 자연스럽게 블렌딩한다.
 * -> 경계선이 딱 잘리지 않고 부드럽게 이어진다(알파 블렌딩과 동일한 원리).
 */
function computeFlashEffect(width, height, srcImageData, maskData) {
  const src = srcImageData.data;
  const output = new ImageData(width, height);
  const out = output.data;

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];

    // 마스크의 R채널(0~255)을 0~1 범위의 "인물일 확률"로 변환
    const personRatio = maskData[i] / 255;

    // --- 인물 보정: 대비 강화 + 노출 증가 + 쿨톤 화이트밸런스 ---
    const personContrast = 1.35;
    const pr = (r - 128) * personContrast + 128 + 28; // 밝기 +28
    const pg = (g - 128) * personContrast + 128 + 22;
    const pb = (b - 128) * personContrast + 128 + 38; // 블루를 더 올려 차가운 톤 연출

    // --- 배경 보정: 노출을 크게 낮춰 어둡게 ---
    const bgContrast = 0.92;
    const br = (r - 128) * bgContrast + 128 - 95; // 밝기 -95
    const bgc = (g - 128) * bgContrast + 128 - 92;
    const bb = (b - 128) * bgContrast + 128 - 80;

    // 마스크 비율로 두 결과를 선형 보간(블렌딩)
    out[i] = pr * personRatio + br * (1 - personRatio);
    out[i + 1] = pg * personRatio + bgc * (1 - personRatio);
    out[i + 2] = pb * personRatio + bb * (1 - personRatio);
    out[i + 3] = 255;
  }

  // 플래시로 찍은 사진 특유의 미세한 그레인 추가
  addFilmGrain(output, 10);

  return output;
}

// ------------------------------------------------------------
// 2) 빈티지 필터 - 필름골드 (따뜻한 색감 + 블랙 리프트 + 그레인)
// ------------------------------------------------------------
function applyFilmGold(imageData) {
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 1) 블랙 리프트: 어두운 부분을 살짝 들어올려 색 바랜 필름 톤 연출
    r = r * 0.92 + 20;
    g = g * 0.92 + 16;
    b = b * 0.9 + 10;

    // 2) 웜톤 컬러 매트릭스: 레드/옐로우 강조, 블루 억제
    r *= 1.1;
    g *= 1.02;
    b *= 0.88;

    // 3) 하이라이트를 살짝 눌러 부드러운 필름 대비감 연출
    r = 255 - (255 - r) * 0.95;
    g = 255 - (255 - g) * 0.97;

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  addFilmGrain(imageData, 14);
}

// ------------------------------------------------------------
// 3) 빈티지 필터 - 틸앤오렌지 (시네마틱 스플릿 톤)
// ------------------------------------------------------------
function applyTealOrange(imageData) {
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 밝기(luminance)를 계산해 그림자/하이라이트를 구분한다 (0~1)
    const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

    if (luminance < 0.5) {
      // 그림자 영역 -> 틸(청록) 톤으로 이동
      const t = (0.5 - luminance) * 2; // 어두울수록 1에 가까움
      r -= 18 * t;
      g += 4 * t;
      b += 22 * t;
    } else {
      // 하이라이트 영역 -> 오렌지 톤으로 이동
      const t = (luminance - 0.5) * 2; // 밝을수록 1에 가까움
      r += 26 * t;
      g += 10 * t;
      b -= 20 * t;
    }

    // 시네마틱한 느낌을 위해 대비를 살짝 강화
    r = (r - 128) * 1.15 + 128;
    g = (g - 128) * 1.15 + 128;
    b = (b - 128) * 1.15 + 128;

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  addFilmGrain(imageData, 8);
}

// ------------------------------------------------------------
// 4) 빈티지 필터 - 레트로페이드 (색 바랜 아날로그 인화지 느낌)
// ------------------------------------------------------------
function applyRetroFade(imageData) {
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 대비를 크게 낮추고 그림자를 들어올려 오래된 인화지 특유의 뿌연 느낌 연출
    r = r * 0.75 + 45;
    g = g * 0.75 + 42;
    b = b * 0.75 + 38;

    // 옛날 필름 특유의 옐로우-그린 색번짐
    g *= 1.03;
    b *= 0.94;

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  addFilmGrain(imageData, 20); // 그레인을 강하게
}

// ------------------------------------------------------------
// 공통 유틸: 필름 그레인(노이즈) / 비네팅
// ------------------------------------------------------------

/**
 * 각 픽셀에 동일한 랜덤 노이즈 값을 R/G/B에 함께 더해 "휘도 노이즈"를 만든다.
 * (채널별로 다른 노이즈를 주면 알록달록한 디지털 노이즈가 되어 필름 그레인과는 느낌이 다르다)
 */
function addFilmGrain(imageData, amount) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
}

/**
 * 캔버스 중심에서 바깥으로 갈수록 어두워지는 radial gradient를
 * 'multiply' 합성 모드로 덧그려 비네팅(가장자리 감광) 효과를 만든다.
 * 픽셀 반복문 대신 Canvas 2D API의 그라디언트+합성을 사용해
 * GPU 가속의 이점을 살리고 코드를 단순하게 유지한다.
 */
function drawVignette(context, width, height, strength) {
  const gradient = context.createRadialGradient(
    width / 2, height / 2, height * 0.35,
    width / 2, height / 2, height * 0.9
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${strength})`);

  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

// ------------------------------------------------------------
// 다운로드
// ------------------------------------------------------------
downloadBtn.addEventListener('click', () => {
  if (!state.originalImageData) return;

  const link = document.createElement('a');
  link.download = `vintage-cam_${Date.now()}.jpg`;
  link.href = mainCanvas.toDataURL('image/jpeg', 0.95);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// ------------------------------------------------------------
// 앱 시작
// ------------------------------------------------------------
initSegmentation();
