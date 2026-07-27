'use strict';

/* =========================================================================
 * Vintage Cam - 100% 클라이언트(브라우저) 사진 필터 앱
 *
 * 서버 없이 동작하는 구조:
 *  1) 사용자가 고른 사진을 오프스크린 캔버스(state.originalCanvas)에 원본으로 보관한다.
 *  2) 필터는 실제 Instagram이 쓰는 것과 같은 2단계 기법으로 구현한다:
 *       ① Canvas 2D의 ctx.filter (CSS filter 함수: contrast/saturate/brightness 등)
 *          -> 브라우저 네이티브 구현이라 감마 보정이 정확해서 클리핑/밴딩 없이 톤이 유지된다.
 *       ② 단색을 globalCompositeOperation(overlay/soft-light/darken 등 blend mode)으로
 *          겹쳐 그려서 톤 구간별로 다르게 반응하는 색보정을 만든다.
 *     (오픈소스 CSSgram(Una Kravets, MIT License)이 정리한 Instagram 필터 레시피를
 *      Canvas 2D API로 포팅한 것 — 직접 발명한 픽셀 공식보다 훨씬 검증된 결과를 낸다)
 *  3) 그레인(필름 노이즈)과 비네팅은 모든 필터 공통으로 마지막에 덧입힌다.
 * =========================================================================
 */

// ------------------------------------------------------------
// DOM 참조
// ------------------------------------------------------------
const canvasWrap = document.getElementById('canvasWrap');
const mainCanvas = document.getElementById('mainCanvas');
// willReadFrequently: 그레인 적용 시 getImageData/putImageData를 호출하므로
// 브라우저에게 CPU 경로 최적화를 힌트로 알려준다.
const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });

const placeholder = document.getElementById('placeholder');
const controls = document.getElementById('controls');
const filterRow = document.getElementById('filterRow');
const downloadBtn = document.getElementById('downloadBtn');
const uploadBtn = document.getElementById('uploadBtn');
const changeImageBtn = document.getElementById('changeImageBtn');
const fileInput = document.getElementById('fileInput');

// 캔버스에 그릴 이미지의 최대 긴 변(px). 스마트폰 원본 사진(수천만 화소)을
// 그대로 픽셀 반복문에 넣으면 느려지므로 적당한 크기로 축소한다.
const MAX_DIM = 1440;

// 앱의 현재 상태
const state = {
  originalCanvas: null, // 필터 적용 전 원본 이미지를 담은 오프스크린 캔버스 (모든 필터는 항상 여기서 다시 시작 = 비파괴 편집)
  currentFilter: 'original',
};

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
    img.onerror = () => alert('이미지를 불러올 수 없습니다. 다른 파일을 선택해주세요.');
    img.src = e.target.result;
  };
  reader.onerror = () => alert('파일을 읽는 중 오류가 발생했습니다.');
  reader.readAsDataURL(file);
}

function onImageReady(img) {
  // 긴 변을 기준으로 MAX_DIM 이하로 축소 (비율 유지)
  let { width, height } = img;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  mainCanvas.width = width;
  mainCanvas.height = height;

  // 원본을 별도의 오프스크린 캔버스에 보관해둔다.
  // 모든 필터가 항상 이 원본에서 새로 시작하므로 여러 번 눌러도 화질이 누적 손상되지 않는다.
  state.originalCanvas = document.createElement('canvas');
  state.originalCanvas.width = width;
  state.originalCanvas.height = height;
  state.originalCanvas.getContext('2d').drawImage(img, 0, 0, width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(state.originalCanvas, 0, 0);

  state.currentFilter = 'original';

  // UI 전환: 업로드 화면 숨기고 캔버스/컨트롤 노출
  placeholder.hidden = true;
  mainCanvas.hidden = false;
  controls.hidden = false;
  downloadBtn.disabled = false;
  setActiveFilterButton('original');
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
 * 항상 state.originalCanvas(원본)에서 새로 그리기 시작하므로,
 * 필터를 여러 번 눌러도 화질이 누적 손상되지 않는다(비파괴 편집).
 */
function applyFilter(name) {
  if (!state.originalCanvas) return;

  const { width, height } = mainCanvas;

  switch (name) {
    case 'original': {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(state.originalCanvas, 0, 0);
      break;
    }

    case 'clarendon': {
      applyClarendon(ctx, width, height);
      applyGrainToCanvas(ctx, width, height, 10);
      drawVignette(ctx, width, height, 0.3);
      break;
    }

    case 'gingham': {
      applyGingham(ctx, width, height);
      applyGrainToCanvas(ctx, width, height, 8);
      drawVignette(ctx, width, height, 0.18);
      break;
    }

    case 'lark': {
      applyLark(ctx, width, height);
      applyGrainToCanvas(ctx, width, height, 8);
      drawVignette(ctx, width, height, 0.2);
      break;
    }

    case 'moon': {
      applyMoon(ctx, width, height);
      applyGrainToCanvas(ctx, width, height, 16);
      drawVignette(ctx, width, height, 0.35);
      break;
    }

    default:
      return;
  }

  state.currentFilter = name;
  setActiveFilterButton(name);
}

// ------------------------------------------------------------
// 색 보정 공통 유틸: ctx.filter(CSS 필터) + blend mode 오버레이
// ------------------------------------------------------------

/**
 * source를 CSS filter 함수(contrast/saturate/brightness/hue-rotate/grayscale 등)를
 * 적용해 context에 그린다. 브라우저 네이티브 구현이라 감마 보정이 정확해서
 * 하이라이트/섀도우가 뭉개지지 않고 톤이 자연스럽게 유지된다.
 */
function drawWithFilter(context, source, width, height, cssFilter) {
  context.save();
  context.filter = cssFilter;
  context.drawImage(source, 0, 0, width, height);
  context.restore();
}

/**
 * 단색을 blend mode(overlay/soft-light/darken/lighten/color-dodge 등)로 겹쳐 그린다.
 * 톤 구간(그림자/중간톤/하이라이트)마다 다르게 반응하기 때문에,
 * 단순히 채널값을 더하고 빼는 것보다 훨씬 자연스러운 색감이 나온다.
 */
function overlayBlend(context, width, height, color, blendMode) {
  context.save();
  context.globalCompositeOperation = blendMode;
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.restore();
}

// ------------------------------------------------------------
// Instagram 필터 알고리즘 포팅 (CSSgram 레시피 기반)
// ------------------------------------------------------------

// 클라렌던: 대비/채도를 올려 쨍하게 만들고 하늘색을 overlay로 살짝 얹는다
function applyClarendon(context, width, height) {
  drawWithFilter(context, state.originalCanvas, width, height, 'contrast(1.2) saturate(1.35)');
  overlayBlend(context, width, height, 'rgba(127, 187, 227, 0.2)', 'overlay');
}

// 깅엄: 살짝 밝게 + 색상환을 틀어서(hue-rotate) 라벤더 톤을 soft-light로 얹는 빈티지 파스텔 느낌
function applyGingham(context, width, height) {
  drawWithFilter(context, state.originalCanvas, width, height, 'brightness(1.05) hue-rotate(-10deg)');
  overlayBlend(context, width, height, 'rgb(230, 230, 250)', 'soft-light');
}

// 라크: 대비를 낮춰 밝고 화사하게 만들고, 남색 color-dodge + 밝은 회색 darken을 겹쳐 하이라이트를 정리
function applyLark(context, width, height) {
  drawWithFilter(context, state.originalCanvas, width, height, 'contrast(0.9)');
  overlayBlend(context, width, height, 'rgb(34, 37, 63)', 'color-dodge');
  overlayBlend(context, width, height, 'rgba(242, 242, 242, 0.8)', 'darken');
}

// 문: 흑백으로 전환 후 대비/밝기를 살짝 올리고, 회색 두 겹(soft-light/lighten)으로 톤을 눌러 드라마틱한 흑백 사진 느낌
function applyMoon(context, width, height) {
  drawWithFilter(context, state.originalCanvas, width, height, 'grayscale(1) contrast(1.1) brightness(1.1)');
  overlayBlend(context, width, height, 'rgb(160, 160, 160)', 'soft-light');
  overlayBlend(context, width, height, 'rgb(56, 56, 56)', 'lighten');
}

// ------------------------------------------------------------
// 공통 유틸: 필름 그레인(노이즈) / 비네팅
// ------------------------------------------------------------

/**
 * 각 픽셀에 동일한 랜덤 노이즈 값을 R/G/B에 함께 더해 "휘도 노이즈"를 만든다.
 * (채널별로 다른 노이즈를 주면 알록달록한 디지털 노이즈가 되어 필름 그레인과는 느낌이 다르다)
 * 밝은 영역일수록 노이즈를 약하게 줘서 실제 필름 그레인처럼 그림자/중간톤에 더 잘 보이게 한다.
 */
function addFilmGrain(imageData, amount) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255; // 0~1
    const weight = 1 - luminance * 0.7; // 밝을수록 약하게, 어두울수록 강하게
    const noise = (Math.random() - 0.5) * amount * weight;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
}

/** 캔버스에서 픽셀 데이터를 꺼내 그레인을 적용하고 다시 그려 넣는다. */
function applyGrainToCanvas(context, width, height, amount) {
  const imageData = context.getImageData(0, 0, width, height);
  addFilmGrain(imageData, amount);
  context.putImageData(imageData, 0, 0);
}

/**
 * 캔버스 중심에서 바깥으로 갈수록 어두워지는 radial gradient를
 * 'multiply' 합성 모드로 덧그려 비네팅(가장자리 감광) 효과를 만든다.
 * 픽셀 반복문 대신 Canvas 2D API의 그라디언트+합성을 사용해
 * GPU 가속의 이점을 살리고 코드를 단순하게 유지한다.
 */
function drawVignette(context, width, height, strength) {
  const gradient = context.createRadialGradient(
    width / 2, height / 2, height * 0.4,
    width / 2, height / 2, height * 1.0
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
  if (!state.originalCanvas) return;

  const link = document.createElement('a');
  link.download = `vintage-cam_${Date.now()}.jpg`;
  link.href = mainCanvas.toDataURL('image/jpeg', 0.95);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});
