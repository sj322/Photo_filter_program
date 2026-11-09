'use strict';

/*
 * Vintage Studio filter catalogue and renderer.
 * These are original looks inspired by film and early digital photographs,
 * not calibrated reproductions of a particular film stock or camera.
 * Pixel processing also works in browsers without CanvasRenderingContext2D.filter.
 */
(function (global) {
  const math = Math; // Cache the math intrinsics for tight pixel loops.
  const presets = Object.freeze([
    { id: 'original', name: '원본', category: 'all', description: '사진 본연의 색감 그대로', badge: 'ORIGINAL' },
    { id: 'ccd2004', name: '2004 포켓 디카', category: 'digital', categories: Object.freeze(['digital', 'new']), description: '시원한 흰색, 또렷한 파랑과 작은 센서의 은은한 색 노이즈', badge: 'CCD 04' },
    { id: 'party-flash', name: '파티 플래시', category: 'digital', categories: Object.freeze(['digital', 'new']), description: '짙은 암부와 깨끗한 밝은 색, 가까이서 찍은 밤의 스냅 분위기', badge: 'FLASH' },
    { id: 'keitai2006', name: '2006 폴더폰', category: 'digital', categories: Object.freeze(['digital', 'retro', 'new']), description: '보랏빛 그림자와 옅게 번지는 색 경계, 오래된 휴대폰 사진', badge: 'KEITAI' },
    { id: 'milk-tea', name: '밀크티 네거', category: 'film', categories: Object.freeze(['film', 'new']), description: '베이지색 밝은 톤과 잔잔한 갈색, 부드럽고 차분한 일상 필름', badge: 'LATTE' },
    { id: 'peach-portrait', name: '피치 포트레이트', category: 'film', categories: Object.freeze(['film', 'new']), description: '피치빛 중간톤과 맑은 하이라이트, 햇살 아래 부드러운 인물 사진', badge: 'PEACH' },
    { id: 'sage-daylight', name: '세이지 데이라이트', category: 'film', categories: Object.freeze(['film', 'new']), description: '녹색을 차분한 올리브로 정돈하고 흰색은 맑게 남기는 낮의 색감', badge: 'SAGE' },
    { id: 'travel-chrome', name: '크롬 트래블', category: 'film', categories: Object.freeze(['film', 'new']), description: '깊은 파랑과 생생한 붉은색, 선명한 여행 슬라이드의 대비', badge: 'CHROME' },
    { id: 'amber-hour', name: '앰버 아워', category: 'cinema', categories: Object.freeze(['cinema', 'new']), description: '구릿빛 햇살과 시원한 그늘, 늦은 오후의 따뜻한 영화색', badge: 'AMBER' },
    { id: 'blue-hour', name: '블루 아워', category: 'cinema', categories: Object.freeze(['cinema', 'new']), description: '푸른 보랏빛 그림자와 장밋빛 밝은 색, 해가 진 뒤의 차분한 공기', badge: 'DUSK' },
    { id: 'neon-diary', name: '네온 다이어리', category: 'cinema', categories: Object.freeze(['cinema', 'new']), description: '짙은 녹청 그림자와 붉게 번지는 광원, 밤거리의 필름 기록', badge: 'NEON' },
    { id: 'silver-flash', name: '실버 플래시', category: 'mono', categories: Object.freeze(['mono', 'new']), description: '깨끗한 흰색과 단단한 검정, 미세한 입자의 흑백 스냅', badge: 'SILVER' },
    { id: 'paper-matte', name: '페이퍼 매트', category: 'retro', categories: Object.freeze(['retro', 'new']), description: '은은한 종이색과 부드러운 회색 그림자, 차분한 매거진 인쇄 톤', badge: 'PAPER' },
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
    // Contemporary, independently art-directed looks. New optional palette and
    // sensor-noise controls are deliberately absent from the retained recipes.
    ccd2004: {
      analog: true, curve: [1, 50, 136, 215, 255],
      channels: [[1, 49, 138, 215, 253], [2, 54, 140, 216, 255], [6, 61, 142, 220, 255]],
      saturation: 1.10, shadow: [1, -2, 4], highlight: [-3, 0, 3],
      grain: 3, grainSize: 0.75, vignette: 0.045, softness: 0.015, bloom: 0.025, chromaNoise: 13,
    },
    'party-flash': {
      analog: true, curve: [0, 35, 145, 228, 255],
      channels: [[0, 37, 149, 230, 255], [1, 36, 145, 228, 255], [5, 43, 145, 226, 252]],
      saturation: 0.92, shadow: [-3, -1, 4], highlight: [0, 0, 1],
      grain: 5, grainSize: 0.8, vignette: 0.16, softness: 0.025, bloom: 0.035, chromaNoise: 8,
    },
    keitai2006: {
      analog: true, curve: [12, 54, 132, 217, 250],
      channels: [[15, 65, 143, 222, 251], [8, 52, 127, 210, 247], [24, 72, 145, 224, 254]],
      saturation: 0.72, shadow: [3, -2, 5], highlight: [1, 2, 0],
      grain: 6, grainSize: 0.8, vignette: 0.055, softness: 0.12, bloom: 0.07, chromaBleed: 0.36, chromaNoise: 19,
    },
    'milk-tea': {
      analog: true, curve: [15, 76, 145, 203, 244],
      channels: [[17, 82, 153, 209, 247], [16, 77, 145, 202, 242], [20, 72, 133, 189, 233]],
      saturation: 0.64, shadow: [1, 0, 2], highlight: [2, 1, -1],
      grain: 7, grainSize: 1.15, vignette: 0.025, softness: 0.07, bloom: 0.045,
    },
    'peach-portrait': {
      analog: true, curve: [7, 73, 145, 207, 251],
      channels: [[9, 79, 153, 212, 253], [8, 74, 144, 207, 251], [13, 76, 141, 203, 249]],
      saturation: 0.90, shadow: [1, 0, 2], highlight: [1, 0, 0],
      colorZones: [{ hue: 25, width: 48, saturation: 0.93, shift: [3, 0, 1] }],
      grain: 4, grainSize: 1.0, vignette: 0.02, softness: 0.06, bloom: 0.065,
    },
    'sage-daylight': {
      analog: true, curve: [6, 61, 132, 204, 251],
      channels: [[8, 64, 135, 205, 252], [9, 66, 135, 204, 251], [12, 64, 127, 194, 248]],
      saturation: 0.87, shadow: [0, 1, 2], highlight: [0, 0, 0],
      colorZones: [{ hue: 116, width: 68, saturation: 0.70, shift: [11, -3, -9] }, { hue: 205, width: 37, saturation: 0.90, shift: [0, 1, 2] }],
      grain: 6, grainSize: 1.05, vignette: 0.035, softness: 0.025, bloom: 0.025,
    },
    'travel-chrome': {
      analog: true, curve: [2, 44, 122, 208, 253],
      channels: [[3, 47, 132, 216, 254], [3, 48, 127, 207, 252], [7, 55, 135, 215, 254]],
      saturation: 1.13, shadow: [0, -1, 4], highlight: [1, 1, 0],
      colorZones: [{ hue: 215, width: 50, saturation: 1.12, shift: [-6, -2, 3] }, { hue: 115, width: 50, saturation: 0.90, shift: [1, -2, 0] }],
      grain: 5, grainSize: 0.95, vignette: 0.055, softness: 0.015, bloom: 0.025,
    },
    'amber-hour': {
      analog: true, curve: [5, 53, 130, 207, 249],
      channels: [[5, 55, 143, 222, 254], [7, 55, 131, 207, 246], [18, 61, 119, 181, 229]],
      saturation: 0.91, shadow: [-4, 1, 8], highlight: [5, 1, -3],
      grain: 9, grainSize: 1.2, vignette: 0.09, softness: 0.04, bloom: 0.12, halation: 0.11,
    },
    'blue-hour': {
      analog: true, curve: [8, 49, 120, 194, 244],
      channels: [[10, 46, 115, 196, 248], [9, 51, 122, 194, 242], [24, 73, 147, 211, 247]],
      saturation: 0.83, shadow: [1, -3, 8], highlight: [7, -2, 2],
      grain: 7, grainSize: 1.15, vignette: 0.10, softness: 0.055, bloom: 0.07,
    },
    'neon-diary': {
      analog: true, curve: [1, 38, 117, 204, 250],
      channels: [[2, 35, 118, 215, 254], [6, 54, 130, 205, 247], [13, 63, 133, 199, 237]],
      saturation: 0.96, shadow: [-6, 6, 7], highlight: [8, -2, -4],
      grain: 13, grainSize: 1.3, vignette: 0.14, softness: 0.04, bloom: 0.17, halation: 0.32,
    },
    'silver-flash': {
      analog: true, monochrome: true, curve: [0, 29, 128, 227, 255],
      saturation: 0, shadow: [0, 0, 0], highlight: [0, 0, 0],
      grain: 7, grainSize: 0.9, vignette: 0.10, softness: 0.015, bloom: 0.035,
    },
    'paper-matte': {
      analog: true, curve: [28, 83, 140, 195, 237],
      channels: [[29, 85, 143, 199, 241], [28, 83, 140, 195, 238], [29, 81, 135, 188, 230]],
      saturation: 0.55, shadow: [0, 0, 1], highlight: [1, 1, 0],
      grain: 10, grainSize: 1.4, vignette: 0.025, softness: 0.045, bloom: 0.02,
    },
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

  // All optical fields are bounded to a 480px long edge and alpha weighted.
  // Highlight energy is measured in linear sRGB, separately from image detail.
  const linearTable = new Float32Array(256);
  const encodedTable = new Float32Array(4097);
  for (let i = 0; i < 256; i += 1) {
    const v = i / 255;
    linearTable[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }
  for (let i = 0; i <= 4096; i += 1) {
    const v = i / 2048;
    encodedTable[i] = 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  }
  function sampleCurve(table, value) {
    // Extend endpoint slopes rather than clipping a color before gamut mapping.
    if (value < 0) return table[0] + value * (table[1] - table[0]);
    if (value >= 255) return table[255] + (value - 255) * (table[255] - table[254]);
    const index = math.floor(value);
    return table[index] + (table[index + 1] - table[index]) * (value - index);
  }
  function linearChannel(value) {
    if (value <= 0) return value / 3294.6;
    if (value > 255) return ((value / 255 + 0.055) / 1.055) ** 2.4;
    return sampleCurve(linearTable, value);
  }
  function encodedChannel(value) {
    if (value <= 0) return value * 3294.6;
    if (value >= 2) return 255 * (1.055 * value ** (1 / 2.4) - 0.055);
    const position = value * 2048;
    const index = math.floor(position);
    return encodedTable[index] + (encodedTable[index + 1] - encodedTable[index]) * (position - index);
  }
  function smoothstep(low, high, value) {
    const t = math.max(0, math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }
  function highlightEnergy(r, g, b) {
    const light = linearTable[r] * 0.2126 + linearTable[g] * 0.7152 + linearTable[b] * 0.0722;
    return smoothstep(0.52, 0.96, light) * light;
  }
  function blurField(input, width, height, radius, horizontalOnly = false) {
    const stride = 5;
    const temporary = new Float32Array(input.length);
    const output = horizontalOnly ? temporary : new Float32Array(input.length);
    const divisor = radius * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      for (let channel = 0; channel < stride; channel += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += input[(y * width + math.max(0, math.min(width - 1, k))) * stride + channel];
        for (let x = 0; x < width; x += 1) {
          temporary[(y * width + x) * stride + channel] = sum / divisor;
          sum += input[(y * width + math.min(width - 1, x + radius + 1)) * stride + channel]
            - input[(y * width + math.max(0, x - radius)) * stride + channel];
        }
      }
    }
    if (horizontalOnly) return output;
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < stride; channel += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += temporary[(math.max(0, math.min(height - 1, k)) * width + x) * stride + channel];
        for (let y = 0; y < height; y += 1) {
          output[(y * width + x) * stride + channel] = sum / divisor;
          sum += temporary[(math.min(height - 1, y + radius + 1) * width + x) * stride + channel]
            - temporary[(math.max(0, y - radius) * width + x) * stride + channel];
        }
      }
    }
    return output;
  }
  function spatialFields(source, width, height, recipe, options) {
    if (!(recipe.softness || recipe.edgeSoftness || recipe.chromaBleed || recipe.bloom * options.bloom || recipe.halation * options.halation)) return null;
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
        const pixel = row + columns[x], target = pixel * 5;
        const alpha = source[offset + 3] / 255;
        field[target] += source[offset] * alpha;
        field[target + 1] += source[offset + 1] * alpha;
        field[target + 2] += source[offset + 2] * alpha;
        field[target + 3] += alpha;
        field[target + 4] += highlightEnergy(source[offset], source[offset + 1], source[offset + 2]) * alpha;
        counts[pixel] += 1;
      }
    }
    for (let pixel = 0; pixel < counts.length; pixel += 1) {
      for (let channel = 0; channel < 5; channel += 1) field[pixel * 5 + channel] /= counts[pixel] || 1;
    }
    const lens = recipe.softness || recipe.edgeSoftness ? blurField(field, smallWidth, smallHeight, 1) : null;
    let glow = null;
    if (recipe.bloom * options.bloom || recipe.halation * options.halation) {
      const radius = math.max(1, math.round(math.min(smallWidth, smallHeight) * 0.007));
      glow = blurField(blurField(field, smallWidth, smallHeight, radius), smallWidth, smallHeight, radius);
      const broad = blurField(glow, smallWidth, smallHeight, radius * 2);
      for (let i = 0; i < glow.length; i += 1) glow[i] = glow[i] * 0.78 + broad[i] * 0.22;
    }
    const chroma = recipe.chromaBleed ? blurField(field, smallWidth, smallHeight, math.max(2, math.round(smallWidth / 100)), true) : null;
    return { lens, glow, chroma, width: smallWidth, height: smallHeight };
  }
  function interpolationAxis(length, gridLength) {
    const lower = new Uint32Array(length), upper = new Uint32Array(length), weight = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = math.max(0, math.min(gridLength - 1, (i + 0.5) * gridLength / length - 0.5));
      lower[i] = math.floor(position); upper[i] = math.min(gridLength - 1, lower[i] + 1); weight[i] = position - lower[i];
    }
    return { lower, upper, weight };
  }
  function randomAt(x, y, seed) {
    let value = math.imul(x + 1, 374761393) ^ math.imul(y + 1, 668265263) ^ seed;
    value = math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }
  // Fixed frame-space lattices: increasing export resolution samples the same
  // grain clusters instead of increasing their count. Unresolved fine grain is
  // attenuated in small thumbnails to avoid aliasing and harsh pixel speckles.
  function grainAxis(length, longEdge, frequency) {
    const lower = new Uint32Array(length), weight = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = (i + 0.5) / longEdge * frequency;
      lower[i] = math.floor(position);
      const t = position - lower[i];
      weight[i] = t * t * (3 - 2 * t);
    }
    return { lower, weight };
  }
  function grainField(width, height, size) {
    const longEdge = math.max(width, height);
    const coarse = 420 / math.max(0.7, size);
    const fine = 1180 / math.max(0.7, size);
    return {
      coarse: { x: grainAxis(width, longEdge, coarse), y: grainAxis(height, longEdge, coarse), gain: math.min(1, longEdge / coarse) },
      fine: { x: grainAxis(width, longEdge, fine), y: grainAxis(height, longEdge, fine), gain: math.min(1, longEdge / fine) },
    };
  }
  function sampleGrain(field, x, y, seed) {
    const nx = field.x.lower[x], ny = field.y.lower[y], wx = field.x.weight[x], wy = field.y.weight[y];
    const a = randomAt(nx, ny, seed), b = randomAt(nx + 1, ny, seed);
    const c = randomAt(nx, ny + 1, seed), d = randomAt(nx + 1, ny + 1, seed);
    return ((a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy - 0.5) * field.gain;
  }
  function interpolate(field, p00, p10, p01, p11, wx, wy, channel) {
    const top = field[p00 + channel] + (field[p10 + channel] - field[p00 + channel]) * wx;
    const bottom = field[p01 + channel] + (field[p11 + channel] - field[p01 + channel]) * wx;
    return top + (bottom - top) * wy;
  }
  function printDust(width, height, count, seed, texture) {
    if (!count || !texture) return [];
    const scale = math.max(width, height) / 1440;
    const radius = math.max(0.45, scale * 0.8), extent = math.ceil(radius);
    const records = [];
    for (let i = 0; i < count; i += 1) {
      const cx = randomAt(i, 13, seed) * (width - 1), cy = randomAt(i, 37, seed) * (height - 1);
      const target = randomAt(i, 59, seed) > 0.7 ? 225 : 24;
      for (let y = math.max(0, math.floor(cy) - extent); y <= math.min(height - 1, math.ceil(cy) + extent); y += 1) {
        for (let x = math.max(0, math.floor(cx) - extent); x <= math.min(width - 1, math.ceil(cx) + extent); x += 1) {
          const distance = ((x - cx) ** 2 + (y - cy) ** 2) / (radius * radius);
          if (distance < 1) records.push({ offset: (y * width + x) * 4, target, opacity: (1 - distance) * 0.20 * math.min(1, scale * 2) * texture });
        }
      }
    }
    return records.sort((a, b) => a.offset - b.offset);
  }
  // Hue-local grading, not subject or skin detection. Smooth hue boundaries
  // and saturation/tone gates leave neutral whites and deep blacks alone.
  // Coordinates are measured before grading, so one zone cannot feed another.
  function gradeColorZones(r, g, b, zones, output) {
    output[0] = r; output[1] = g; output[2] = b;
    const high = math.max(r, g, b);
    const low = math.min(r, g, b);
    const chroma = high - low;
    if (chroma < 0.000001 || high < 0.000001) return;
    let hue;
    if (high === r) hue = (g - b) / chroma;
    else if (high === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue = ((hue * 60) % 360 + 360) % 360;
    const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const normalized = math.max(0, math.min(1, light / 255));
    const gate = math.min(1, chroma / high / 0.32) * 4 * normalized * (1 - normalized);
    for (const zone of zones) {
      const distance = math.abs(hue - zone.hue);
      const circular = math.min(distance, 360 - distance);
      const falloff = math.max(0, 1 - circular / zone.width);
      const weight = falloff * falloff * (3 - 2 * falloff) * gate;
      if (!weight) continue;
      const saturation = zone.saturation - 1;
      output[0] += ((r - light) * saturation + zone.shift[0]) * weight;
      output[1] += ((g - light) * saturation + zone.shift[1]) * weight;
      output[2] += ((b - light) * saturation + zone.shift[2]) * weight;
    }
  }

  function warmColorWeight(r, g, b) {
    const high = math.max(r, g, b), low = math.min(r, g, b), chroma = high - low;
    if (chroma < 1 || high < 1 || high !== r) return 0;
    const hue = ((g - b) / chroma * 60 + 360) % 360;
    const hueWeight = smoothstep(4, 19, hue) * (1 - smoothstep(43, 65, hue));
    const saturation = chroma / high;
    const light = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    return hueWeight * smoothstep(0.06, 0.20, saturation) * (1 - smoothstep(0.70, 0.95, saturation))
      * smoothstep(0.025, 0.13, light) * (1 - smoothstep(0.86, 0.99, light));
  }
  // A compact display-referred sRGB approximation, not an ACES transform.
  // Luminance receives a gentle shoulder; chroma is smoothly compressed toward
  // that luminance before channels reach the display boundary. This avoids the
  // hue turns and flat channel plateaus produced by independent RGB clipping.
  function finishColor(r, g, b, output) {
    const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const mapped = light > 232 ? 232 + 23 * (1 - math.exp(-(light - 232) / 23)) : math.max(0, light);
    const dr = r - light, dg = g - light, db = b - light;
    const upper = math.max(dr, dg, db, 0), lower = -math.min(dr, dg, db, 0);
    const ratio = math.max(upper / math.max(0.00001, 255 - mapped), lower / math.max(0.00001, mapped));
    const chroma = ratio > 0.82 ? (0.82 + 0.18 * (1 - math.exp(-(ratio - 0.82) / 0.18))) / ratio : 1;
    output[0] = mapped + dr * chroma;
    output[1] = mapped + dg * chroma;
    output[2] = mapped + db * chroma;
  }
  function normalizedOption(value, fallback, maximum) {
    const number = value === undefined || value === null ? fallback : Number(value);
    return Number.isFinite(number) ? math.max(0, math.min(maximum, number)) : fallback;
  }
  function optionsFor(options) {
    return {
      texture: normalizedOption(options.texture, 1, 1.5),
      bloom: normalizedOption(options.bloom, 1, 1.5),
      halation: normalizedOption(options.halation, 1, 1.5),
      skinProtect: normalizedOption(options.skinProtect, 0.6, 1),
    };
  }
  function renderFilm(data, width, height, recipe, id, strength, seed, options) {
    const source = new Uint8ClampedArray(data);
    const fields = spatialFields(source, width, height, recipe, options);
    const axisX = fields ? interpolationAxis(width, fields.width) : null;
    const axisY = fields ? interpolationAxis(height, fields.height) : null;
    const grain = options.texture && (recipe.grain || recipe.chromaNoise) ? grainField(width, height, recipe.grainSize || 1.2) : null;
    const horizontal = new Float32Array(width), vertical = new Float32Array(height);
    const leakX = recipe.lightLeak ? new Float32Array(width) : null, leakY = recipe.lightLeak ? new Float32Array(height) : null;
    for (let x = 0; x < width; x += 1) {
      horizontal[x] = ((x + 0.5) / width * 2 - 1) ** 2;
      if (leakX) leakX[x] = math.exp(-1 * (((x + 0.5) / width + 0.02) / 0.19) ** 2);
    }
    for (let y = 0; y < height; y += 1) {
      vertical[y] = ((y + 0.5) / height * 2 - 1) ** 2;
      if (leakY) leakY[y] = 0.30 + 0.70 * math.exp(-1 * (((y + 0.5) / height - 0.72) / 0.36) ** 2);
    }
    const tables = recipe.channelTables || [recipe.table, recipe.table, recipe.table];
    const color = new Float64Array(3);
    const dust = printDust(width, height, recipe.dust, seed, options.texture);
    const monochrome = recipe.monochrome || id === 'moon';
    const protect = monochrome || recipe.tonedMono ? 0 : options.skinProtect * 0.72;
    let dustIndex = 0;
    for (let y = 0, offset = 0; y < height; y += 1) {
      const row0 = fields ? axisY.lower[y] * fields.width * 5 : 0;
      const row1 = fields ? axisY.upper[y] * fields.width * 5 : 0;
      const wy = fields ? axisY.weight[y] : 0;
      const scanline = recipe.scanline ? 1 - recipe.scanline * (0.5 + 0.5 * math.cos((y + 0.5) / math.max(1, height / 480) * math.PI)) : 1;
      for (let x = 0; x < width; x += 1, offset += 4) {
        if (source[offset + 3] === 0) continue;
        const originalR = source[offset], originalG = source[offset + 1], originalB = source[offset + 2];
        let r = originalR, g = originalG, b = originalB;
        const edgeDistance = math.max(0, (horizontal[x] + vertical[y] - 0.12) / 1.88);
        const p00 = fields ? row0 + axisX.lower[x] * 5 : 0, p10 = fields ? row0 + axisX.upper[x] * 5 : 0;
        const p01 = fields ? row1 + axisX.lower[x] * 5 : 0, p11 = fields ? row1 + axisX.upper[x] * 5 : 0;
        const wx = fields ? axisX.weight[x] : 0;
        if (fields?.lens) {
          const softness = (recipe.softness || 0) + (recipe.edgeSoftness || 0) * edgeDistance;
          const alpha = math.max(0.000001, interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 3));
          r += (interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 0) / alpha - r) * softness;
          g += (interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 1) / alpha - g) * softness;
          b += (interpolate(fields.lens, p00, p10, p01, p11, wx, wy, 2) / alpha - b) * softness;
        }
        if (fields?.chroma) {
          const alpha = math.max(0.000001, interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 3));
          const cr = interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 0) / alpha;
          const cg = interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 1) / alpha;
          const cb = interpolate(fields.chroma, p00, p10, p01, p11, wx, wy, 2) / alpha;
          const ownLight = r * 0.2126 + g * 0.7152 + b * 0.0722, neighborLight = cr * 0.2126 + cg * 0.7152 + cb * 0.0722;
          r += ((cr - neighborLight) - (r - ownLight)) * recipe.chromaBleed;
          g += ((cg - neighborLight) - (g - ownLight)) * recipe.chromaBleed;
          b += ((cb - neighborLight) - (b - ownLight)) * recipe.chromaBleed;
        }
        if (recipe.legacy) {
          legacyColor(id, r, g, b, color); r = color[0]; g = color[1]; b = color[2];
        } else {
          if (recipe.colorZones) {
            gradeColorZones(r, g, b, recipe.colorZones, color); r = color[0]; g = color[1]; b = color[2];
          }
          if (monochrome || recipe.tonedMono) r = g = b = r * 0.2126 + g * 0.7152 + b * 0.0722;
          r = sampleCurve(tables[0], r); g = sampleCurve(tables[1], g); b = sampleCurve(tables[2], b);
          const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
          const luma = math.max(0, math.min(1, light / 255)), shadows = (1 - luma) ** 2, highlights = luma ** 2;
          r = light + (r - light) * recipe.saturation + recipe.shadow[0] * shadows + recipe.highlight[0] * highlights + (recipe.tint?.[0] || 0);
          g = light + (g - light) * recipe.saturation + recipe.shadow[1] * shadows + recipe.highlight[1] * highlights + (recipe.tint?.[1] || 0);
          b = light + (b - light) * recipe.saturation + recipe.shadow[2] * shadows + recipe.highlight[2] * highlights + (recipe.tint?.[2] || 0);
        }
        if (fields?.glow) {
          const alpha = math.max(0.000001, interpolate(fields.glow, p00, p10, p01, p11, wx, wy, 3));
          const energy = math.max(0, interpolate(fields.glow, p00, p10, p01, p11, wx, wy, 4) / alpha);
          // Only energy spreading beyond a bright region forms a colored halo.
          // A uniform bright surface has zero excess, including bright skin.
          const halo = math.max(0, energy - highlightEnergy(originalR, originalG, originalB)) * (recipe.halation || 0) * options.halation;
          const bloom = energy * (recipe.bloom || 0) * options.bloom * 0.25;
          if (halo > 0.000001 || bloom > 0.000001) {
            r = encodedChannel(linearChannel(r) + bloom + halo * 0.22);
            g = encodedChannel(linearChannel(g) + bloom + halo * 0.045);
            b = encodedChannel(linearChannel(b) + bloom);
          }
        }
        if (leakX) {
          const leak = leakX[x] * leakY[y] * recipe.lightLeak;
          r += (255 - r) * leak; g += (255 - g) * leak * 0.29; b += (255 - b) * leak * 0.055;
        }
        if (protect) {
          const amount = warmColorWeight(originalR, originalG, originalB) * protect;
          if (amount > 0) {
            const originalLight = originalR * 0.2126 + originalG * 0.7152 + originalB * 0.0722;
            const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
            const scale = math.max(0.25, math.min(1.75, light / math.max(1, originalLight)));
            r += ((originalR - originalLight) * scale - (r - light)) * amount;
            g += ((originalG - originalLight) * scale - (g - light)) * amount;
            b += ((originalB - originalLight) * scale - (b - light)) * amount;
          }
        }
        const luma = math.max(0, math.min(1, (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255));
        let noise = 0;
        if (grain) {
          const coarse = sampleGrain(grain.coarse, x, y, seed ^ 0x6c8e9cf5);
          const fine = sampleGrain(grain.fine, x, y, seed ^ 0x217ab23d);
          const response = 0.32 + 0.68 * math.sqrt(math.max(0, 4 * luma * (1 - luma)));
          noise = (coarse * 0.65 + fine * 0.75) * recipe.grain * options.texture * response;
          if (recipe.chromaNoise && !monochrome) {
            const amount = recipe.chromaNoise * (1 - luma) ** 2 * options.texture;
            // Chroma mottling has a larger footprint than luminance grain.
            const redNoise = sampleGrain(grain.coarse, x, y, seed ^ 0x187db1c5) * amount;
            const blueNoise = sampleGrain(grain.coarse, x, y, seed ^ 0x52e7a839) * amount;
            r += redNoise; g -= (redNoise * 0.2126 + blueNoise * 0.0722) / 0.7152; b += blueNoise;
          }
        }
        const vignette = (1 - recipe.vignette * edgeDistance * edgeDistance) * scanline;
        r = (r + noise) * vignette; g = (g + noise) * vignette; b = (b + noise) * vignette;
        while (dustIndex < dust.length && dust[dustIndex].offset < offset) dustIndex += 1;
        while (dustIndex < dust.length && dust[dustIndex].offset === offset) {
          const speck = dust[dustIndex++];
          r += (speck.target - r) * speck.opacity; g += (speck.target - g) * speck.opacity;
          b += (speck.target - (monochrome ? 0 : 3) - b) * speck.opacity;
        }
        finishColor(r, g, b, color);
        if (monochrome) color[1] = color[2] = color[0];
        // Fixed, sub-LSB dither is independent of the texture seed. It avoids
        // visible rounding contours without changing clean-render reproducibility.
        const dither = (randomAt(x, y, 0x4a91ef23) - 0.5) * 0.65;
        data[offset] = originalR + (color[0] - originalR + dither) * strength;
        data[offset + 1] = originalG + (color[1] - originalG + dither) * strength;
        data[offset + 2] = originalB + (color[2] - originalB + dither) * strength;
      }
    }
  }
  function getCapabilities(id) {
    const recipe = recipes[id];
    return Object.freeze({
      texture: Boolean(recipe && (recipe.grain || recipe.chromaNoise || recipe.dust)),
      bloom: Boolean(recipe?.bloom), halation: Boolean(recipe?.halation),
      skinProtect: Boolean(recipe && !recipe.monochrome && !recipe.tonedMono && id !== 'moon'),
    });
  }
  /**
   * Render a complete float-pixel grade, then mix strength and quantize once.
   * strength 0..1; texture/bloom/halation 0..1.5; skinProtect 0..1.
   * The source and alpha are unchanged. An opaque 8-bit sRGB input cannot regain
   * clipped source detail; shoulder and gamut compression preserve what remains.
   */
  function render(context, sourceCanvas, id, options = {}) {
    if (!context || !sourceCanvas) throw new TypeError('A context and source canvas are required.');
    if (context.canvas === sourceCanvas) throw new TypeError('Source and destination canvases must be different.');
    if (id !== 'original' && !Object.prototype.hasOwnProperty.call(recipes, id)) throw new RangeError(`Unknown filter: ${id}`);
    const strength = normalizedOption(options.strength, 1, 1);
    const { width, height } = context.canvas;
    if (!width || !height || !sourceCanvas.width || !sourceCanvas.height) return;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      if ('filter' in context) context.filter = 'none';
      context.shadowColor = 'rgba(0,0,0,0)'; context.shadowBlur = 0;
      context.clearRect(0, 0, width, height);
      context.drawImage(sourceCanvas, 0, 0, width, height);
      if (id === 'original' || strength === 0) return;
      const image = context.getImageData(0, 0, width, height);
      renderFilm(image.data, width, height, recipes[id], id, strength,
        ((Number(options.seed ?? 1) >>> 0) ^ hashString(id)) >>> 0, optionsFor(options));
      context.putImageData(image, 0, 0);
    } finally { context.restore(); }
  }
  global.VintageFilters = Object.freeze({ presets, render, getCapabilities, version: 2 });
})(window);
