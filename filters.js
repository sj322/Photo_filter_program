'use strict';

/*
 * Vintage Cam filter catalogue and renderer.
 * These are original looks inspired by film and early digital photographs,
 * not calibrated reproductions of a particular film stock or camera.
 * Pixel processing also works in browsers without CanvasRenderingContext2D.filter.
 */
(function (global) {
  const math = Math; // Cache the math intrinsics for tight pixel loops.
  const presets = Object.freeze([
    { id: 'original', name: '원본', category: 'all', description: '사진 본연의 색감 그대로', badge: 'ORIGINAL' },
    { id: 'album1991', name: '1991 가족앨범', category: 'nineties', description: '꿀빛 인화지, 부드러운 초점과 빛바랜 가족사진', badge: '1991' },
    { id: 'school1994', name: '1994 수학여행', category: 'nineties', description: '짙은 초록과 붉은 피부톤, 거친 필름 스냅', badge: '1994' },
    { id: 'summer1996', name: '1996 여름휴가', category: 'nineties', description: '청록 바다와 노란 햇살이 남은 여름 필름', badge: '1996' },
    { id: 'flash1998', name: '1998 플래시', category: 'nineties', description: '밝은 중간톤, 차가운 그림자와 플래시 스냅의 대비', badge: '1998' },
    { id: 'minilab1995', name: '1995 동네사진관', category: 'nineties', description: '녹빛 암부와 따뜻한 흰색, 작은 사진관의 인화색', badge: '1995' },
    { id: 'camcorder1999', name: '1999 캠코더', category: 'nineties', description: '번지는 색 경계와 부드러운 빛, 홈비디오 한 장면', badge: '1999' },
    { id: 'expired-roll', name: '유통기한 지난 필름', category: 'vintage', description: '보랏빛 그림자와 누렇게 변한 밝은 색, 불균일한 입자', badge: 'EXPIRED' },
    { id: 'sunfaded-slide', name: '햇빛 바랜 슬라이드', category: 'vintage', description: '볕에 바랜 푸른색과 크림색 하이라이트', badge: 'FADED' },
    { id: 'amber-print', name: '앰버 인화지', category: 'vintage', description: '호박빛 중간톤과 눌린 흰색, 오래 보관한 인화사진', badge: 'AMBER' },
    { id: 'rose-print', name: '로즈 인화지', category: 'vintage', description: '분홍빛으로 물든 인화지와 흐릿한 푸른 그림자', badge: 'ROSE' },
    { id: 'silver-print', name: '은염 인화', category: 'vintage', categories: Object.freeze(['vintage', 'mono']), description: '깊은 검정과 살아 있는 중간톤, 거친 은염 입자', badge: 'SILVER' },
    { id: 'sepia-archive', name: '세피아 아카이브', category: 'vintage', description: '빛바랜 갈색 은염사진, 종이 결처럼 남는 잔입자', badge: 'ARCHIVE' },
    { id: 'half-frame', name: '하프 프레임', category: 'retro', description: '작은 필름을 확대한 입자와 따뜻한 여행 스냅', badge: 'HALF' },
    { id: 'toy-lens', name: '토이 카메라', category: 'retro', description: '주변부의 부드러운 초점과 깊은 색, 작은 플라스틱 렌즈', badge: 'TOY' },
    { id: 'red-leak', name: '빛샘 필름', category: 'retro', description: '한쪽 가장자리로 스며드는 붉은 빛과 필름 입자', badge: 'LEAK' },
    { id: 'warm-mist', name: '소프트 글로우', category: 'retro', description: '밝은 빛 주변으로 퍼지는 따뜻한 번짐과 부드러운 초점', badge: 'GLOW' },
    { id: 'daily400', name: '데일리 400', category: 'film', description: '자연스러운 피부색과 부드러운 햇살', badge: '400' },
    { id: 'gold200', name: '골드 200', category: 'film', description: '따뜻한 노란빛, 여행 앨범 속 오후', badge: '200' },
    { id: 'green400', name: '그린 400', category: 'film', description: '산뜻한 초록과 살짝 차가운 그림자', badge: '400' },
    { id: 'classic-negative', name: '클래식 네거', category: 'film', description: '깊은 그림자와 차분한 빈티지 색감', badge: 'NEG' },
    { id: 'soft-pastel', name: '소프트 파스텔', category: 'film', description: '연한 분홍빛과 뽀얗게 풀린 대비', badge: 'SOFT' },
    { id: 'cinema800', name: '시네마 800', category: 'cinema', description: '청록빛 그림자와 따뜻한 영화 속 조명', badge: '800' },
    { id: 'cool-digicam', name: '쿨 디카', category: 'digital', description: '푸른 화이트 밸런스와 또렷한 옛 디카 색감', badge: 'CCD C' },
    { id: 'warm-digicam', name: '웜 디카', category: 'digital', description: '따뜻하고 선명한 2000년대 일상 스냅', badge: 'CCD W' },
    { id: 'disposable', name: '일회용 카메라', category: 'film', description: '거친 입자와 짙은 가장자리의 추억', badge: 'SNAP' },
    { id: 'instant', name: '인스턴트', category: 'film', description: '크리미한 흰색과 살짝 바랜 즉석사진', badge: 'INSTANT' },
    { id: 'faded-brown', name: '페이드 브라운', category: 'film', description: '은은한 갈색과 오래된 앨범의 부드러운 색', badge: 'FADE' },
    { id: 'silver-mono', name: '실버 모노', category: 'mono', description: '섬세한 입자와 깊이 있는 은염 흑백', badge: 'B&W' },
    { id: 'clarendon', name: '클라렌던', category: 'classic', description: '선명한 대비와 시원한 하늘색', badge: 'CLASSIC' },
    { id: 'gingham', name: '깅엄', category: 'classic', description: '밝고 부드러운 라벤더 톤', badge: 'CLASSIC' },
    { id: 'lark', name: '라크', category: 'classic', description: '밝고 화사하게 정돈한 색감', badge: 'CLASSIC' },
    { id: 'moon', name: '문', category: 'mono', categories: Object.freeze(['mono', 'classic']), description: '부드러운 회색으로 풀어낸 흑백', badge: 'B&W' },
  ].map(Object.freeze));

  // Curve control points correspond to input values 0, 64, 128, 192 and 255.
  // Tints are small channel offsets weighted by image luminance, not flat overlays.
  const recipes = {
    // New analog looks have separate dye curves and optical/texture treatments.
    // The numbers are art-directed interpretations, not measured film profiles.
    album1991: {
      analog: true, curve: [15, 69, 137, 195, 243],
      channels: [[18, 75, 145, 204, 248], [14, 69, 137, 195, 242], [20, 63, 120, 178, 222]],
      saturation: 0.82, shadow: [4, 2, 1], highlight: [5, 2, -3],
      grain: 14, grainSize: 1.5, vignette: 0.13, softness: 0.13, bloom: 0.11, halation: 0.06, dust: 14,
    },
    school1994: {
      analog: true, curve: [7, 52, 129, 198, 247],
      channels: [[10, 56, 139, 207, 251], [12, 58, 132, 195, 245], [14, 50, 114, 179, 231]],
      saturation: 0.98, shadow: [-3, 5, 1], highlight: [5, 1, -4],
      grain: 19, grainSize: 1.6, vignette: 0.18, softness: 0.08, bloom: 0.07, halation: 0.07, dust: 8,
    },
    summer1996: {
      analog: true, curve: [7, 57, 134, 205, 251],
      channels: [[8, 54, 135, 209, 253], [12, 65, 140, 206, 249], [18, 64, 124, 187, 231]],
      saturation: 1.04, shadow: [-8, 4, 8], highlight: [6, 4, -3],
      grain: 12, grainSize: 1.3, vignette: 0.12, softness: 0.06, bloom: 0.12, halation: 0.08,
    },
    flash1998: {
      analog: true, curve: [2, 45, 143, 222, 252],
      channels: [[3, 48, 149, 225, 254], [4, 48, 144, 218, 251], [13, 54, 141, 214, 244]],
      saturation: 0.88, shadow: [-3, 1, 7], highlight: [2, 0, -2],
      grain: 18, grainSize: 1.4, vignette: 0.25, softness: 0.045, bloom: 0.10, halation: 0.04,
    },
    minilab1995: {
      analog: true, curve: [12, 64, 132, 193, 243],
      channels: [[13, 63, 139, 205, 249], [18, 72, 139, 196, 241], [14, 63, 119, 177, 226]],
      saturation: 0.85, shadow: [-3, 5, 0], highlight: [5, 2, -4],
      grain: 14, grainSize: 1.35, vignette: 0.09, softness: 0.10, bloom: 0.07, dust: 10,
    },
    camcorder1999: {
      analog: true, curve: [12, 59, 130, 203, 246],
      channels: [[11, 63, 141, 215, 249], [14, 61, 135, 204, 243], [24, 65, 125, 191, 233]],
      saturation: 0.77, shadow: [0, 1, 6], highlight: [4, 0, -3],
      grain: 9, grainSize: 1.15, vignette: 0.07, softness: 0.17, bloom: 0.24, chromaBleed: 0.68, scanline: 0.009,
    },
    'expired-roll': {
      analog: true, curve: [22, 72, 133, 190, 237],
      channels: [[29, 83, 143, 202, 245], [14, 61, 124, 185, 237], [31, 81, 135, 180, 214]],
      saturation: 0.76, shadow: [5, -4, 5], highlight: [8, 5, -9],
      grain: 24, grainSize: 2.2, vignette: 0.14, softness: 0.09, bloom: 0.08, dust: 24,
    },
    'sunfaded-slide': {
      analog: true, curve: [25, 79, 139, 195, 237],
      channels: [[28, 85, 148, 204, 245], [27, 82, 142, 196, 237], [35, 85, 134, 179, 215]],
      saturation: 0.66, shadow: [-2, 1, 7], highlight: [5, 3, -5],
      grain: 12, grainSize: 1.4, vignette: 0.05, softness: 0.12, bloom: 0.13, dust: 8,
    },
    'amber-print': {
      analog: true, curve: [10, 61, 126, 186, 237],
      channels: [[15, 75, 145, 205, 249], [12, 64, 129, 187, 234], [16, 51, 102, 153, 201]],
      saturation: 0.74, shadow: [3, 1, -2], highlight: [4, 1, -4],
      grain: 15, grainSize: 1.4, vignette: 0.12, softness: 0.09, bloom: 0.09, dust: 12,
    },
    'rose-print': {
      analog: true, curve: [19, 74, 139, 199, 242],
      channels: [[25, 86, 151, 209, 248], [15, 65, 126, 188, 232], [27, 78, 135, 191, 234]],
      saturation: 0.74, shadow: [3, -3, 5], highlight: [6, 1, -1],
      grain: 13, grainSize: 1.5, vignette: 0.09, softness: 0.14, bloom: 0.13, dust: 10,
    },
    'silver-print': {
      analog: true, monochrome: true, curve: [7, 45, 125, 207, 249],
      saturation: 0, shadow: [0, 0, 0], highlight: [0, 0, 0],
      grain: 25, grainSize: 1.8, vignette: 0.16, softness: 0.045, bloom: 0.08, dust: 16,
    },
    'sepia-archive': {
      analog: true, tonedMono: true, curve: [18, 65, 131, 190, 235],
      channels: [[23, 79, 148, 207, 246], [19, 66, 129, 187, 228], [17, 50, 100, 151, 195]],
      saturation: 0.86, shadow: [2, 1, -1], highlight: [3, 1, -2],
      grain: 18, grainSize: 1.8, vignette: 0.15, softness: 0.14, bloom: 0.07, dust: 28,
    },
    'half-frame': {
      analog: true, curve: [10, 56, 133, 202, 247],
      channels: [[13, 65, 145, 211, 251], [12, 61, 135, 200, 245], [20, 57, 119, 183, 229]],
      saturation: 0.90, shadow: [1, 3, 4], highlight: [5, 2, -4],
      grain: 27, grainSize: 2.5, vignette: 0.18, softness: 0.13, bloom: 0.11, halation: 0.10, dust: 10,
    },
    'toy-lens': {
      analog: true, curve: [8, 44, 124, 204, 250],
      channels: [[10, 44, 135, 214, 253], [12, 50, 125, 200, 245], [22, 58, 132, 196, 234]],
      saturation: 1.06, shadow: [1, -2, 5], highlight: [6, 1, -6],
      grain: 18, grainSize: 1.7, vignette: 0.34, softness: 0.07, edgeSoftness: 0.34, bloom: 0.12, halation: 0.08,
    },
    'red-leak': {
      analog: true, curve: [10, 58, 134, 201, 248],
      channels: [[13, 65, 143, 209, 250], [13, 61, 133, 198, 243], [20, 63, 128, 187, 228]],
      saturation: 0.87, shadow: [-2, 2, 5], highlight: [5, 2, -4],
      grain: 18, grainSize: 1.6, vignette: 0.14, softness: 0.09, bloom: 0.10, halation: 0.12, lightLeak: 0.48, dust: 8,
    },
    'warm-mist': {
      analog: true, curve: [13, 69, 139, 203, 247],
      channels: [[16, 76, 149, 212, 252], [13, 70, 139, 201, 245], [19, 66, 126, 185, 229]],
      saturation: 0.80, shadow: [1, 2, 5], highlight: [5, 2, -3],
      grain: 10, grainSize: 1.2, vignette: 0.09, softness: 0.16, bloom: 0.44, halation: 0.19,
    },
    daily400: {
      curve: [5, 67, 136, 198, 250], saturation: 0.88,
      shadow: [1, 1, 3], highlight: [5, 2, -3], tint: [1, 0, -1], grain: 5, vignette: 0.06,
    },
    gold200: {
      curve: [5, 61, 131, 201, 251], saturation: 1.07,
      shadow: [4, 1, -5], highlight: [8, 4, -8], tint: [3, 1, -4], grain: 7, vignette: 0.09,
    },
    green400: {
      curve: [6, 59, 129, 196, 248], saturation: 0.96,
      shadow: [-6, 5, 4], highlight: [3, 2, -4], tint: [-2, 2, -1], grain: 7, vignette: 0.07,
    },
    'classic-negative': {
      curve: [8, 51, 121, 198, 251], saturation: 0.83,
      shadow: [-4, 5, 6], highlight: [8, 2, -7], tint: [2, -1, -2], grain: 8, vignette: 0.1,
    },
    'soft-pastel': {
      curve: [15, 82, 146, 206, 250], saturation: 0.72,
      shadow: [3, -2, 6], highlight: [7, 1, 0], tint: [1, 0, 1], grain: 4, vignette: 0.025,
    },
    cinema800: {
      curve: [3, 49, 124, 197, 249], saturation: 0.87,
      shadow: [-12, 5, 11], highlight: [15, 6, -9], tint: [1, 0, -1], grain: 9, vignette: 0.12,
    },
    'cool-digicam': {
      curve: [1, 58, 129, 200, 253], saturation: 0.9,
      shadow: [-4, 2, 9], highlight: [-5, 1, 7], tint: [-2, 0, 3], grain: 3, vignette: 0.05,
    },
    'warm-digicam': {
      curve: [2, 59, 134, 207, 255], saturation: 1.04,
      shadow: [3, 0, -2], highlight: [7, 2, -5], tint: [3, 0, -2], grain: 2.5, vignette: 0.04,
    },
    disposable: {
      curve: [10, 57, 133, 207, 248], saturation: 0.93,
      shadow: [-5, 4, -1], highlight: [8, 4, -6], tint: [1, 1, -3], grain: 15, vignette: 0.22,
    },
    instant: {
      curve: [19, 77, 137, 195, 239], saturation: 0.73,
      shadow: [4, 4, -1], highlight: [6, 3, -5], tint: [2, 1, -2], grain: 7, vignette: 0.11,
    },
    'faded-brown': {
      curve: [17, 70, 132, 189, 238], saturation: 0.63,
      shadow: [7, 3, -2], highlight: [8, 4, -6], tint: [3, 1, -4], grain: 8, vignette: 0.08,
    },
    'silver-mono': {
      curve: [5, 52, 128, 204, 253], saturation: 0, monochrome: true,
      shadow: [0, 0, 0], highlight: [0, 0, 0], tint: [0, 0, 0], grain: 12, vignette: 0.13,
    },
    clarendon: { legacy: true, grain: 10, vignette: 0.3 },
    gingham: { legacy: true, grain: 8, vignette: 0.18 },
    lark: { legacy: true, grain: 8, vignette: 0.2 },
    moon: { legacy: true, grain: 16, vignette: 0.35 },
  };

  const clamp = (value) => value < 0 ? 0 : value > 255 ? 255 : value;
  const squareRoot = math.sqrt;

  function buildCurve(points) {
    const x = [0, 64, 128, 192, 255];
    const slopes = points.slice(1).map((value, i) => (value - points[i]) / (x[i + 1] - x[i]));
    const tangents = [slopes[0]];
    for (let i = 1; i < 4; i += 1) {
      // Harmonic tangents keep this monotonic curve from overshooting its control points.
      tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
    }
    tangents.push(slopes[3]);
    const table = new Float32Array(256);
    let section = 0;
    for (let value = 0; value < 256; value += 1) {
      if (section < 3 && value > x[section + 1]) section += 1;
      const span = x[section + 1] - x[section];
      const t = (value - x[section]) / span;
      const t2 = t * t;
      const t3 = t2 * t;
      table[value] = (2 * t3 - 3 * t2 + 1) * points[section]
        + (t3 - 2 * t2 + t) * span * tangents[section]
        + (-2 * t3 + 3 * t2) * points[section + 1]
        + (t3 - t2) * span * tangents[section + 1];
    }
    return table;
  }

  Object.values(recipes).forEach((recipe) => {
    if (recipe.curve) recipe.table = buildCurve(recipe.curve);
    if (recipe.channels) recipe.channelTables = recipe.channels.map(buildCurve);
  });

  function softLight(base, color) {
    const b = base / 255;
    const s = color / 255;
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : squareRoot(b);
    return 255 * (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b));
  }

  function overlay(base, color) {
    return base <= 127.5 ? 2 * base * color / 255 : 255 - 2 * (255 - base) * (255 - color) / 255;
  }

  // Existing CSSgram-inspired recipes (Una Kravets, MIT) are retained as
  // equivalent CSS color matrices and blend equations.
  // Tiny rounding differences from a browser's native filter implementation are possible.
  const hue = -10 * math.PI / 180;
  const cosine = math.cos(hue);
  const sine = math.sin(hue);
  const hueMatrix = [
    0.213 + cosine * 0.787 - sine * 0.213, 0.715 - cosine * 0.715 - sine * 0.715, 0.072 - cosine * 0.072 + sine * 0.928,
    0.213 - cosine * 0.213 + sine * 0.143, 0.715 + cosine * 0.285 + sine * 0.14, 0.072 - cosine * 0.072 - sine * 0.283,
    0.213 - cosine * 0.213 - sine * 0.787, 0.715 - cosine * 0.715 + sine * 0.715, 0.072 + cosine * 0.928 + sine * 0.072,
  ];

  function legacyColor(id, r, g, b, output) {
    if (id === 'clarendon') {
      r = clamp((r - 127.5) * 1.2 + 127.5);
      g = clamp((g - 127.5) * 1.2 + 127.5);
      b = clamp((b - 127.5) * 1.2 + 127.5);
      const luma = 0.213 * r + 0.715 * g + 0.072 * b;
      r = clamp(luma + (r - luma) * 1.35);
      g = clamp(luma + (g - luma) * 1.35);
      b = clamp(luma + (b - luma) * 1.35);
      output[0] = r * 0.8 + overlay(r, 127) * 0.2;
      output[1] = g * 0.8 + overlay(g, 187) * 0.2;
      output[2] = b * 0.8 + overlay(b, 227) * 0.2;
    } else if (id === 'gingham') {
      r = clamp(r * 1.05);
      g = clamp(g * 1.05);
      b = clamp(b * 1.05);
      output[0] = softLight(clamp(hueMatrix[0] * r + hueMatrix[1] * g + hueMatrix[2] * b), 230);
      output[1] = softLight(clamp(hueMatrix[3] * r + hueMatrix[4] * g + hueMatrix[5] * b), 230);
      output[2] = softLight(clamp(hueMatrix[6] * r + hueMatrix[7] * g + hueMatrix[8] * b), 250);
    } else if (id === 'lark') {
      r = clamp(((r - 127.5) * 0.9 + 127.5) / (1 - 34 / 255));
      g = clamp(((g - 127.5) * 0.9 + 127.5) / (1 - 37 / 255));
      b = clamp(((b - 127.5) * 0.9 + 127.5) / (1 - 63 / 255));
      output[0] = r * 0.2 + (r < 242 ? r : 242) * 0.8;
      output[1] = g * 0.2 + (g < 242 ? g : 242) * 0.8;
      output[2] = b * 0.2 + (b < 242 ? b : 242) * 0.8;
    } else {
      const gray = clamp((clamp((0.2126 * r + 0.7152 * g + 0.0722 * b - 127.5) * 1.1 + 127.5)) * 1.1);
      const blended = softLight(gray, 160);
      const moon = blended < 56 ? 56 : blended;
      output[0] = moon;
      output[1] = moon;
      output[2] = moon;
    }
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash = math.imul(hash ^ value.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }

  // Box passes approximate lens diffusion. All fields are premultiplied by
  // alpha, including highlight energy, so hidden RGB never bleeds into a photo.
  function blurField(input, width, height, radius, horizontalOnly = false) {
    const stride = 5;
    const temporary = new Float32Array(input.length);
    const output = horizontalOnly ? temporary : new Float32Array(input.length);
    const divisor = radius * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      for (let channel = 0; channel < stride; channel += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const x = math.max(0, math.min(width - 1, k));
          sum += input[(y * width + x) * stride + channel];
        }
        for (let x = 0; x < width; x += 1) {
          temporary[(y * width + x) * stride + channel] = sum / divisor;
          const remove = math.max(0, x - radius);
          const add = math.min(width - 1, x + radius + 1);
          sum += input[(y * width + add) * stride + channel] - input[(y * width + remove) * stride + channel];
        }
      }
    }
    if (horizontalOnly) return output;
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < stride; channel += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const y = math.max(0, math.min(height - 1, k));
          sum += temporary[(y * width + x) * stride + channel];
        }
        for (let y = 0; y < height; y += 1) {
          output[(y * width + x) * stride + channel] = sum / divisor;
          const remove = math.max(0, y - radius);
          const add = math.min(height - 1, y + radius + 1);
          sum += temporary[(add * width + x) * stride + channel] - temporary[(remove * width + x) * stride + channel];
        }
      }
    }
    return output;
  }

  function spatialFields(source, width, height, recipe) {
    const scale = math.min(1, 480 / math.max(width, height));
    const smallWidth = math.max(1, math.ceil(width * scale));
    const smallHeight = math.max(1, math.ceil(height * scale));
    const field = new Float32Array(smallWidth * smallHeight * 5);
    const counts = new Uint32Array(smallWidth * smallHeight);
    const columns = new Uint32Array(width);
    for (let x = 0; x < width; x += 1) columns[x] = math.min(smallWidth - 1, math.floor(x * smallWidth / width));
    for (let y = 0, offset = 0; y < height; y += 1) {
      const row = math.min(smallHeight - 1, math.floor(y * smallHeight / height)) * smallWidth;
      for (let x = 0; x < width; x += 1, offset += 4) {
        const pixel = row + columns[x];
        const target = pixel * 5;
        const alpha = source[offset + 3] / 255;
        const luminance = 0.2126 * source[offset] + 0.7152 * source[offset + 1] + 0.0722 * source[offset + 2];
        const highlight = math.max(0, (luminance - 172) / 83);
        field[target] += source[offset] * alpha;
        field[target + 1] += source[offset + 1] * alpha;
        field[target + 2] += source[offset + 2] * alpha;
        field[target + 3] += alpha;
        field[target + 4] += highlight * highlight * alpha;
        counts[pixel] += 1;
      }
    }
    for (let pixel = 0; pixel < counts.length; pixel += 1) {
      const divisor = counts[pixel] || 1;
      for (let channel = 0; channel < 5; channel += 1) field[pixel * 5 + channel] /= divisor;
    }
    const lens = blurField(field, smallWidth, smallHeight, 1);
    const radius = math.max(1, math.round(math.min(smallWidth, smallHeight) * 0.009));
    const glow = blurField(blurField(field, smallWidth, smallHeight, radius), smallWidth, smallHeight, radius);
    const chroma = recipe.chromaBleed ? blurField(field, smallWidth, smallHeight, math.max(2, math.round(smallWidth / 100)), true) : null;
    return { lens, glow, chroma, width: smallWidth, height: smallHeight };
  }

  function interpolationAxis(length, gridLength) {
    const lower = new Uint32Array(length);
    const upper = new Uint32Array(length);
    const weight = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = math.max(0, math.min(gridLength - 1, (i + 0.5) * gridLength / length - 0.5));
      lower[i] = math.floor(position);
      upper[i] = math.min(gridLength - 1, lower[i] + 1);
      weight[i] = position - lower[i];
    }
    return { lower, upper, weight };
  }

  function randomAt(x, y, seed) {
    let value = math.imul(x + 1, 374761393) ^ math.imul(y + 1, 668265263) ^ seed;
    value = math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  function grainField(width, height, size, seed) {
    const cell = math.max(1.25, math.max(width, height) / 600 * size);
    const columns = math.max(2, math.ceil(width / cell) + 1);
    const rows = math.max(2, math.ceil(height / cell) + 1);
    const values = new Float32Array(columns * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) values[y * columns + x] = randomAt(x, y, seed ^ 0x6c8e9cf5) - 0.5;
    }
    return { values, width: columns, x: interpolationAxis(width, columns), y: interpolationAxis(height, rows) };
  }

  function interpolate(field, p00, p10, p01, p11, wx, wy, channel) {
    const top = field[p00 + channel] + (field[p10 + channel] - field[p00 + channel]) * wx;
    const bottom = field[p01 + channel] + (field[p11 + channel] - field[p01 + channel]) * wx;
    return top + (bottom - top) * wy;
  }

  // A few small irregular specks, used only on archival print styles.
  // Pixel positions are normalized, so a thumbnail doesn't acquire giant dust.
  function addPrintDust(data, width, height, count, seed, monochrome) {
    const scale = math.max(width, height) / 1440;
    const radius = math.max(0.45, scale * 0.8);
    for (let i = 0; i < count; i += 1) {
      const centerX = randomAt(i, 13, seed) * (width - 1);
      const centerY = randomAt(i, 37, seed) * (height - 1);
      const light = randomAt(i, 59, seed) > 0.7;
      const extent = math.ceil(radius);
      for (let y = math.max(0, math.floor(centerY) - extent); y <= math.min(height - 1, math.ceil(centerY) + extent); y += 1) {
        for (let x = math.max(0, math.floor(centerX) - extent); x <= math.min(width - 1, math.ceil(centerX) + extent); x += 1) {
          const distance = ((x - centerX) ** 2 + (y - centerY) ** 2) / (radius * radius);
          if (distance >= 1) continue;
          const offset = (y * width + x) * 4;
          if (data[offset + 3] === 0) continue;
          const opacity = (1 - distance) * 0.20 * math.min(1, scale * 2);
          const target = light ? 225 : 24;
          data[offset] += (target - data[offset]) * opacity;
          data[offset + 1] += (target - data[offset + 1]) * opacity;
          data[offset + 2] += ((monochrome ? target : target - 3) - data[offset + 2]) * opacity;
        }
      }
    }
  }

  function renderAnalog(data, width, height, recipe, strength, seed) {
    const source = new Uint8ClampedArray(data);
    const fields = spatialFields(source, width, height, recipe);
    const axisX = interpolationAxis(width, fields.width);
    const axisY = interpolationAxis(height, fields.height);
    const grain = grainField(width, height, recipe.grainSize, seed);
    const horizontal = new Float32Array(width);
    const vertical = new Float32Array(height);
    const leakX = recipe.lightLeak ? new Float32Array(width) : null;
    const leakY = recipe.lightLeak ? new Float32Array(height) : null;
    for (let x = 0; x < width; x += 1) {
      horizontal[x] = ((x + 0.5) / width * 2 - 1) ** 2;
      if (leakX) leakX[x] = math.exp(-1 * (((x + 0.5) / width + 0.02) / 0.19) ** 2);
    }
    for (let y = 0; y < height; y += 1) {
      vertical[y] = ((y + 0.5) / height * 2 - 1) ** 2;
      if (leakY) leakY[y] = 0.30 + 0.70 * math.exp(-1 * (((y + 0.5) / height - 0.72) / 0.36) ** 2);
    }
    const tables = recipe.channelTables || [recipe.table, recipe.table, recipe.table];
    const textureScale = 0.4 + 0.6 * math.min(1, math.max(width, height) / 800);
    const fieldWidth = fields.width * 5;
    for (let y = 0, offset = 0; y < height; y += 1) {
      const row0 = axisY.lower[y] * fieldWidth;
      const row1 = axisY.upper[y] * fieldWidth;
      const wy = axisY.weight[y];
      const noiseRow0 = grain.y.lower[y] * grain.width;
      const noiseRow1 = grain.y.upper[y] * grain.width;
      const noiseWY = grain.y.weight[y];
      const scanline = recipe.scanline ? 1 - recipe.scanline * (0.5 + 0.5 * math.cos((y + 0.5) / math.max(1, height / 480) * math.PI)) : 1;
      for (let x = 0; x < width; x += 1, offset += 4) {
        if (source[offset + 3] === 0) continue;
        const p00 = row0 + axisX.lower[x] * 5;
        const p10 = row0 + axisX.upper[x] * 5;
        const p01 = row1 + axisX.lower[x] * 5;
        const p11 = row1 + axisX.upper[x] * 5;
        const wx = axisX.weight[x];
        const edgeDistance = math.max(0, (horizontal[x] + vertical[y] - 0.12) / 1.88);
        const softness = recipe.softness + (recipe.edgeSoftness || 0) * edgeDistance;
        const lensAlpha = math.max(0.000001, interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 3));
        let r = source[offset];
        let g = source[offset + 1];
        let b = source[offset + 2];
        r += (interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 0) / lensAlpha - r) * softness;
        g += (interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 1) / lensAlpha - g) * softness;
        b += (interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 2) / lensAlpha - b) * softness;
        if (fields.chroma) {
          const chromaAlpha = math.max(0.000001, interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 3));
          const cr = interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 0) / chromaAlpha;
          const cg = interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 1) / chromaAlpha;
          const cb = interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 2) / chromaAlpha;
          const ownLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const neighborLuma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          r += ((cr - neighborLuma) - (r - ownLuma)) * recipe.chromaBleed;
          g += ((cg - neighborLuma) - (g - ownLuma)) * recipe.chromaBleed;
          b += ((cb - neighborLuma) - (b - ownLuma)) * recipe.chromaBleed;
        }
        if (recipe.monochrome || recipe.tonedMono) {
          const gray = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b);
          r = gray;
          g = gray;
          b = gray;
        }
        r = tables[0][math.round(clamp(r))];
        g = tables[1][math.round(clamp(g))];
        b = tables[2][math.round(clamp(b))];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const luma = luminance / 255;
        const shadows = (1 - luma) ** 2;
        const highlights = luma ** 2;
        r = luminance + (r - luminance) * recipe.saturation + recipe.shadow[0] * shadows + recipe.highlight[0] * highlights;
        g = luminance + (g - luminance) * recipe.saturation + recipe.shadow[1] * shadows + recipe.highlight[1] * highlights;
        b = luminance + (b - luminance) * recipe.saturation + recipe.shadow[2] * shadows + recipe.highlight[2] * highlights;

        const glowAlpha = math.max(0.000001, interpolate(fields.glow, p00, p10, p01, p11, wx, wy, 3));
        const glow = math.max(0, interpolate(fields.glow, p00, p10, p01, p11, wx, wy, 4) / glowAlpha);
        const bloom = glow * recipe.bloom;
        // Screen blending lifts a bright light's surroundings without clipping it.
        r += (255 - r) * bloom;
        g += (255 - g) * bloom;
        b += (255 - b) * bloom;
        if (recipe.halation) {
          const originalLuma = (0.2126 * source[offset] + 0.7152 * source[offset + 1] + 0.0722 * source[offset + 2]) / 255;
          const halo = glow * (1 - originalLuma * originalLuma) * recipe.halation;
          r += (255 - r) * halo;
          g += (255 - g) * halo * 0.22;
        }
        if (leakX) {
          const leak = leakX[x] * leakY[y] * recipe.lightLeak;
          r += (255 - r) * leak;
          g += (255 - g) * leak * 0.29;
          b += (255 - b) * leak * 0.055;
        }
        const nx0 = grain.x.lower[x];
        const nx1 = grain.x.upper[x];
        const noiseWX = grain.x.weight[x];
        const topNoise = grain.values[noiseRow0 + nx0] + (grain.values[noiseRow0 + nx1] - grain.values[noiseRow0 + nx0]) * noiseWX;
        const bottomNoise = grain.values[noiseRow1 + nx0] + (grain.values[noiseRow1 + nx1] - grain.values[noiseRow1 + nx0]) * noiseWX;
        const correlated = topNoise + (bottomNoise - topNoise) * noiseWY;
        const noise = ((randomAt(x, y, seed) - 0.5) * 0.65 + correlated * 0.95)
          * recipe.grain * (1 - luma * 0.65) * textureScale;
        const vignette = (1 - recipe.vignette * edgeDistance * edgeDistance) * scanline;
        r = clamp((r + noise) * vignette);
        g = clamp((g + noise) * vignette);
        b = clamp((b + noise) * vignette);
        if (recipe.monochrome) g = b = r;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
      }
    }
    if (recipe.dust) addPrintDust(data, width, height, recipe.dust, seed, recipe.monochrome);
    if (strength < 1) {
      for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = source[offset] + (data[offset] - source[offset]) * strength;
        data[offset + 1] = source[offset + 1] + (data[offset + 1] - source[offset + 1]) * strength;
        data[offset + 2] = source[offset + 2] + (data[offset + 2] - source[offset + 2]) * strength;
      }
    }
  }

  /**
   * Paint sourceCanvas at the destination canvas size, then apply a preset.
   * strength is 0..1; seed fixes the grain pattern across repeated renders.
   * The source canvas is never modified. Destination alpha is preserved.
   */
  function render(context, sourceCanvas, id, options = {}) {
    if (!context || !sourceCanvas) throw new TypeError('A context and source canvas are required.');
    if (context.canvas === sourceCanvas) throw new TypeError('Source and destination canvases must be different.');
    if (id !== 'original' && !Object.prototype.hasOwnProperty.call(recipes, id)) {
      throw new RangeError(`Unknown filter: ${id}`);
    }
    const requestedStrength = Number(options.strength ?? 1);
    const strength = Number.isFinite(requestedStrength) ? math.max(0, math.min(1, requestedStrength)) : 1;
    const { width, height } = context.canvas;
    if (!width || !height || !sourceCanvas.width || !sourceCanvas.height) return;

    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      if ('filter' in context) context.filter = 'none';
      context.shadowColor = 'rgba(0,0,0,0)';
      context.shadowBlur = 0;
      context.clearRect(0, 0, width, height);
      context.drawImage(sourceCanvas, 0, 0, width, height);
      if (id === 'original' || strength === 0) return;

      const recipe = recipes[id];
      const imageData = context.getImageData(0, 0, width, height);
      const data = imageData.data;
      if (recipe.analog) {
        renderAnalog(data, width, height, recipe, strength, ((Number(options.seed ?? 1) >>> 0) ^ hashString(id)) >>> 0);
        context.putImageData(imageData, 0, 0);
        return;
      }
      const color = new Float64Array(3);
      let randomState = ((Number(options.seed ?? 1) >>> 0) ^ hashString(id)) >>> 0 || 1;

      // Normalize both axes: portrait and landscape images receive the same
      // edge falloff instead of a circle sized only from the image's height.
      const horizontal = new Float32Array(width);
      const vertical = new Float32Array(height);
      for (let x = 0; x < width; x += 1) horizontal[x] = ((x + 0.5) / width * 2 - 1) ** 2;
      for (let y = 0; y < height; y += 1) vertical[y] = ((y + 0.5) / height * 2 - 1) ** 2;

      for (let y = 0, offset = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1, offset += 4) {
          const originalR = data[offset];
          const originalG = data[offset + 1];
          const originalB = data[offset + 2];
          // Preserve fully transparent pixels as well as their alpha.
          if (data[offset + 3] === 0) continue;
          let r;
          let g;
          let b;
          if (recipe.legacy) {
            legacyColor(id, originalR, originalG, originalB, color);
            r = color[0];
            g = color[1];
            b = color[2];
          } else {
            if (recipe.monochrome) {
              const gray = (0.2126 * originalR + 0.7152 * originalG + 0.0722 * originalB + 0.5) | 0;
              r = recipe.table[gray];
              g = r;
              b = r;
            } else {
              r = recipe.table[originalR];
              g = recipe.table[originalG];
              b = recipe.table[originalB];
            }
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const highlightWeight = (luminance / 255) ** 2;
            const shadowWeight = (1 - luminance / 255) ** 2;
            r = luminance + (r - luminance) * recipe.saturation
              + recipe.tint[0] + recipe.shadow[0] * shadowWeight + recipe.highlight[0] * highlightWeight;
            g = luminance + (g - luminance) * recipe.saturation
              + recipe.tint[1] + recipe.shadow[1] * shadowWeight + recipe.highlight[1] * highlightWeight;
            b = luminance + (b - luminance) * recipe.saturation
              + recipe.tint[2] + recipe.shadow[2] * shadowWeight + recipe.highlight[2] * highlightWeight;
          }

          // Xorshift32 gives stable luminance grain without storing a noise image.
          randomState ^= randomState << 13;
          randomState ^= randomState >>> 17;
          randomState ^= randomState << 5;
          const luminance = clamp((r + g + b) / 3) / 255;
          const noise = ((randomState >>> 0) / 4294967296 - 0.5) * recipe.grain * (1 - luminance * 0.7);
          const distance = (horizontal[x] + vertical[y] - 0.18) / 1.82;
          const radius = distance > 0 ? distance : 0;
          const edge = 1 - recipe.vignette * radius * radius;
          r = clamp((r + noise) * edge);
          g = clamp((g + noise) * edge);
          b = clamp((b + noise) * edge);

          data[offset] = originalR + (r - originalR) * strength;
          data[offset + 1] = originalG + (g - originalG) * strength;
          data[offset + 2] = originalB + (b - originalB) * strength;
        }
      }
      context.putImageData(imageData, 0, 0);
    } finally {
      context.restore();
    }
  }

  global.VintageFilters = Object.freeze({ presets, render });
})(window);
