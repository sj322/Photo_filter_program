'use strict';

// Photo geometry and manual editing shared by preview, thumbnails and export.
// The original canvas is read only; render() always returns a new canvas.
(function (global) {
  const math = Math;
  const defaults = Object.freeze({
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, saturation: 0,
    fade: 0, grain: 0, vignette: 0, texture: 100, bloom: 100, halation: 100,
    skinProtect: 60, rotate: 0, aspect: 'original',
  });
  const aspects = Object.freeze({ '1:1': 1, '4:5': 4 / 5, '3:2': 3 / 2, '9:16': 9 / 16 });
  const clamp = (value, low, high) => math.max(low, math.min(high, value));
  const channel = (value) => clamp(value, 0, 255);
  const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  function normalizeEdits(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    const rotation = math.round(finiteNumber(input.rotate) / 90) * 90;
    return {
      exposure: clamp(finiteNumber(input.exposure), -100, 100),
      contrast: clamp(finiteNumber(input.contrast), -100, 100),
      highlights: clamp(finiteNumber(input.highlights), -100, 100),
      shadows: clamp(finiteNumber(input.shadows), -100, 100),
      temperature: clamp(finiteNumber(input.temperature), -100, 100),
      saturation: clamp(finiteNumber(input.saturation), -100, 100),
      fade: clamp(finiteNumber(input.fade), 0, 100),
      grain: clamp(finiteNumber(input.grain), 0, 100),
      vignette: clamp(finiteNumber(input.vignette), 0, 100),
      texture: clamp(finiteNumber(input.texture, 100), 0, 150),
      bloom: clamp(finiteNumber(input.bloom, 100), 0, 150),
      halation: clamp(finiteNumber(input.halation, 100), 0, 150),
      skinProtect: clamp(finiteNumber(input.skinProtect, 60), 0, 100),
      rotate: ((rotation % 360) + 360) % 360,
      aspect: Object.prototype.hasOwnProperty.call(aspects, input.aspect) ? input.aspect : 'original',
    };
  }

  function sourceDimensions(source) {
    const width = Number(source && source.width);
    const height = Number(source && source.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new TypeError('A non-empty source canvas is required.');
    }
    return { width, height };
  }

  /**
   * Compute centered crop dimensions after clockwise quarter-turn rotation.
   * maxDimension is the longest output edge, 1..4096px; images are not enlarged.
   * Source may be a canvas or simply {width, height}.
   */
  function orientedSize(source, edits = {}, maxDimension = 1440) {
    const { width: sourceWidth, height: sourceHeight } = sourceDimensions(source);
    const normalized = normalizeEdits(edits);
    const rotated = normalized.rotate === 90 || normalized.rotate === 270;
    const orientedWidth = rotated ? sourceHeight : sourceWidth;
    const orientedHeight = rotated ? sourceWidth : sourceHeight;
    let cropWidth = orientedWidth;
    let cropHeight = orientedHeight;
    const ratio = aspects[normalized.aspect];
    if (ratio) {
      if (orientedWidth / orientedHeight > ratio) cropWidth = orientedHeight * ratio;
      else cropHeight = orientedWidth / ratio;
    }
    const limit = maxDimension === Infinity ? 4096 : clamp(finiteNumber(maxDimension, 1440), 1, 4096);
    const scale = math.min(1, limit / math.max(cropWidth, cropHeight));
    return {
      width: math.max(1, math.round(cropWidth * scale)),
      height: math.max(1, math.round(cropHeight * scale)),
      sourceWidth, sourceHeight, orientedWidth, orientedHeight,
      cropX: (orientedWidth - cropWidth) / 2,
      cropY: (orientedHeight - cropHeight) / 2,
      cropWidth, cropHeight,
      rotation: normalized.rotate,
      scale,
    };
  }

  function linearize(value) {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }

  function encode(value) {
    return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  }

  function randomAt(x, y, seed) {
    let value = math.imul(x + 1, 374761393) ^ math.imul(y + 1, 668265263) ^ seed;
    value = math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  // A fixed lattice in frame coordinates keeps added grain clusters the same
  // relative size when previewing and exporting. Only these small fields and
  // axis tables are allocated; no full-resolution floating-point frame is kept.
  function grainLayer(width, height, frequency, seed) {
    const longest = math.max(width, height);
    const columns = math.ceil(width / longest * frequency) + 2;
    const rows = math.ceil(height / longest * frequency) + 2;
    const field = new Float32Array(columns * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) field[y * columns + x] = randomAt(x, y, seed) - 0.5;
    }
    const axis = (length) => {
      const lower = new Uint32Array(length);
      const weight = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        const position = (i + 0.5) / longest * frequency;
        lower[i] = math.floor(position);
        const fraction = position - lower[i];
        weight[i] = fraction * fraction * (3 - 2 * fraction);
      }
      return { lower, weight };
    };
    return { field, columns, x: axis(width), y: axis(height) };
  }

  function grainSample(layer, x, y) {
    const offset = layer.y.lower[y] * layer.columns + layer.x.lower[x];
    const wx = layer.x.weight[x], wy = layer.y.weight[y];
    const top = layer.field[offset] + (layer.field[offset + 1] - layer.field[offset]) * wx;
    const lower = offset + layer.columns;
    const bottom = layer.field[lower] + (layer.field[lower + 1] - layer.field[lower]) * wx;
    return top + (bottom - top) * wy;
  }

  function smoothstep(low, high, value) {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Display-referred sRGB approximation: roll off only when positive exposure
  // or contrast requests extra headroom. Then reduce excessive chroma toward
  // the neutral axis instead of clipping individual RGB channels independently.
  // This does not reconstruct detail that was already clipped in the source.
  function mapToneAndGamut(r, g, b, headroom, toe, output) {
    const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let mapped = light;
    if (headroom > 0 && light > 255 - headroom) {
      mapped = 255 - headroom * math.exp(-(light - (255 - headroom)) / headroom);
    }
    if (toe > 0 && mapped < toe) mapped = toe / (1 + (toe - mapped) / toe);
    mapped = clamp(mapped, 0, 255);
    const ratio = light > 0.000001 ? mapped / light : 1;
    const dr = (r - light) * ratio;
    const dg = (g - light) * ratio;
    const db = (b - light) * ratio;
    const positive = math.max(dr, dg, db);
    const negative = math.min(dr, dg, db);
    const limit = math.min(positive > 0.000001 ? (255 - mapped) / positive : Infinity,
      negative < -0.000001 ? -mapped / negative : Infinity);
    let chroma = 1;
    if (limit < 1 / 0.88) {
      const extent = limit > 0 ? 1 / limit : Infinity;
      // A small boundary reserve survives final 8-bit rounding instead of
      // turning highly saturated colors into exact channel clipping again.
      chroma = Number.isFinite(extent) ? (0.88 + 0.11 * (1 - math.exp(-(extent - 0.88) / 0.11))) / extent : 0;
    }
    output[0] = mapped + dr * chroma;
    output[1] = mapped + dg * chroma;
    output[2] = mapped + db * chroma;
  }

  /**
   * Mutates RGB in ImageData and returns the same object; alpha is preserved.
   * Exposure -100..100 represents -1..+1 stop, applied in linearized sRGB.
   * Remaining tone controls are perceptual approximations in encoded RGB.
   * Positive exposure keeps highlight values floating until a soft shoulder.
   * Grain is correlated luminance noise in normalized frame coordinates.
   */
  function adjustPixels(imageData, edits = {}, options = {}) {
    if (!imageData || !imageData.data || !Number.isInteger(imageData.width)
      || !Number.isInteger(imageData.height) || imageData.width < 1 || imageData.height < 1
      || imageData.data.length !== imageData.width * imageData.height * 4) {
      throw new TypeError('Valid RGBA ImageData is required.');
    }
    const settings = normalizeEdits(edits);
    const { exposure, contrast, highlights, shadows, temperature, saturation, fade, grain, vignette } = settings;
    const toneActive = exposure || contrast || highlights || shadows || temperature || saturation || fade;
    if (!(toneActive || grain || vignette)) return imageData;
    const { data, width, height } = imageData;
    const exposureScale = 2 ** (exposure / 100);
    const exposureTable = exposure ? new Float32Array(256) : null;
    if (exposureTable) {
      for (let value = 0; value < 256; value += 1) {
        exposureTable[value] = encode(linearize(value / 255) * exposureScale) * 255;
      }
    }
    const contrastScale = 1 + contrast * 0.0065;
    const saturationScale = 1 + saturation / 100;
    const fadeAmount = fade * 0.0035;
    const grainAmount = grain * 0.42;
    const vignetteAmount = vignette * 0.006;
    const seed = finiteNumber(options.seed, 42) >>> 0;
    const fineGrain = grain ? grainLayer(width, height, 720, seed) : null;
    const coarseGrain = grain ? grainLayer(width, height, 240, seed ^ 0x7f4a7c15) : null;
    const mappedColor = toneActive ? new Float64Array(3) : null;
    const headroom = 75 * math.max(0, exposure / 100, contrast / 100, highlights / 100);
    const toe = 12 * math.max(0, contrast / 100);
    const horizontal = vignette ? new Float32Array(width) : null;
    if (horizontal) {
      for (let x = 0; x < width; x += 1) horizontal[x] = ((x + 0.5) / width * 2 - 1) ** 2;
    }
    for (let y = 0, offset = 0; y < height; y += 1) {
      const vertical = vignette ? ((y + 0.5) / height * 2 - 1) ** 2 : 0;
      for (let x = 0; x < width; x += 1, offset += 4) {
        if (!data[offset + 3]) continue;
        let r = exposureTable ? exposureTable[data[offset]] : data[offset];
        let g = exposureTable ? exposureTable[data[offset + 1]] : data[offset + 1];
        let b = exposureTable ? exposureTable[data[offset + 2]] : data[offset + 2];
        if (contrast) {
          r = (r - 127.5) * contrastScale + 127.5;
          g = (g - 127.5) * contrastScale + 127.5;
          b = (b - 127.5) * contrastScale + 127.5;
        }
        if (highlights || shadows) {
          const light = clamp((r * 0.2126 + g * 0.7152 + b * 0.0722) / 255, 0, 1);
          const highlightMask = smoothstep(0.40, 0.92, light);
          const shadowMask = 1 - smoothstep(0.06, 0.62, light);
          // Luminance-zone exposure preserves channel ratios. Both controls
          // reach zero influence toward the opposite end of the tonal range.
          const stops = highlights / 100 * highlightMask * 0.65
            + shadows / 100 * shadowMask * 0.90;
          const gain = 2 ** stops;
          r *= gain; g *= gain; b *= gain;
        }
        if (temperature) {
          const light = clamp((r * 0.2126 + g * 0.7152 + b * 0.0722) / 255, 0, 1);
          const midtones = 4 * light * (1 - light);
          r += temperature * 0.22 * midtones;
          g += temperature * 0.03 * midtones;
          b -= temperature * 0.20 * midtones;
        }
        if (saturation) {
          const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
          r = light + (r - light) * saturationScale;
          g = light + (g - light) * saturationScale;
          b = light + (b - light) * saturationScale;
        }
        if (fade) {
          r = r * (1 - fadeAmount * 0.8) + fadeAmount * 128;
          g = g * (1 - fadeAmount * 0.8) + fadeAmount * 128;
          b = b * (1 - fadeAmount * 0.8) + fadeAmount * 128;
        }
        if (toneActive) {
          // Raising highlights can exceed the display range even without EV.
          mapToneAndGamut(r, g, b, headroom, toe, mappedColor);
          r = mappedColor[0]; g = mappedColor[1]; b = mappedColor[2];
        }
        if (grain) {
          const light = clamp((r * 0.2126 + g * 0.7152 + b * 0.0722) / 255, 0, 1);
          const noise = (grainSample(fineGrain, x, y) * 0.75 + grainSample(coarseGrain, x, y) * 0.25)
            * grainAmount * (1 - light * 0.55);
          r += noise;
          g += noise;
          b += noise;
        }
        if (vignette) {
          const radius = math.max(0, (horizontal[x] + vertical - 0.18) / 1.82);
          const edge = 1 - radius * radius * vignetteAmount;
          r *= edge;
          g *= edge;
          b *= edge;
        }
        data[offset] = channel(r);
        data[offset + 1] = channel(g);
        data[offset + 2] = channel(b);
      }
    }
    return imageData;
  }

  function createCanvas(width, height) {
    const canvas = global.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /**
   * Geometry → manual tone corrections → film preset → additional texture.
   * strength uses UI percentages (0..100), whereas VintageFilters uses 0..1.
   * compare keeps rotation and crop so before/after frames line up exactly.
   */
  function render(sourceCanvas, options = {}) {
    const settings = normalizeEdits(options.edits);
    const size = orientedSize(sourceCanvas, settings, options.maxDimension ?? 1440);
    const filter = typeof options.filter === 'string' ? options.filter : 'original';
    const strength = clamp(finiteNumber(options.strength, 80), 0, 100);
    const seed = finiteNumber(options.seed, 42) >>> 0;
    if (!options.compare && filter !== 'original'
      && !global.VintageFilters?.presets.some((preset) => preset.id === filter)) {
      throw new RangeError('Unknown filter: ' + filter);
    }
    const base = createCanvas(size.width, size.height);
    const baseContext = base.getContext('2d', { willReadFrequently: true });
    if (!baseContext) throw new Error('Canvas 2D is unavailable.');
    baseContext.imageSmoothingEnabled = true;
    baseContext.imageSmoothingQuality = 'high';
    baseContext.save();
    baseContext.translate(size.width / 2, size.height / 2);
    baseContext.scale(size.width / size.cropWidth, size.height / size.cropHeight);
    baseContext.rotate(size.rotation * math.PI / 180);
    baseContext.drawImage(sourceCanvas, -size.sourceWidth / 2, -size.sourceHeight / 2);
    baseContext.restore();
    if (options.compare) return base;

    if (settings.exposure || settings.contrast || settings.highlights || settings.shadows
      || settings.temperature || settings.saturation || settings.fade) {
      const image = baseContext.getImageData(0, 0, size.width, size.height);
      adjustPixels(image, { ...settings, grain: 0, vignette: 0 }, { seed });
      baseContext.putImageData(image, 0, 0);
    }
    let output = base;
    let context = baseContext;
    if (filter !== 'original' && strength > 0) {
      output = createCanvas(size.width, size.height);
      context = output.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas 2D is unavailable.');
      global.VintageFilters.render(context, base, filter, {
        strength: strength / 100, seed, texture: settings.texture / 100,
        bloom: settings.bloom / 100, halation: settings.halation / 100, skinProtect: settings.skinProtect / 100,
      });
      // Only the returned result must stay allocated at export resolution.
      base.width = base.height = 1;
    }
    if (settings.grain || settings.vignette) {
      const image = context.getImageData(0, 0, size.width, size.height);
      adjustPixels(image, { grain: settings.grain, vignette: settings.vignette }, { seed });
      context.putImageData(image, 0, 0);
    }
    return output;
  }

  /** Six deterministic suggestions based only on aggregate brightness/color. */
  function recommend(sourceCanvas) {
    const source = sourceDimensions(sourceCanvas);
    const scale = math.min(1, 64 / math.max(source.width, source.height));
    const sample = createCanvas(math.max(1, math.round(source.width * scale)), math.max(1, math.round(source.height * scale)));
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D is unavailable.');
    context.drawImage(sourceCanvas, 0, 0, sample.width, sample.height);
    const { data } = context.getImageData(0, 0, sample.width, sample.height);
    let luminance = 0;
    let saturation = 0;
    let warmth = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = math.max(r, g, b);
      const min = math.min(r, g, b);
      luminance += (r * 0.2126 + g * 0.7152 + b * 0.0722) * alpha;
      saturation += (max ? (max - min) / max : 0) * alpha;
      warmth += (r - b) * alpha;
      weight += alpha;
    }
    sample.width = sample.height = 1;
    weight = weight || 1;
    luminance /= weight;
    saturation /= weight;
    warmth /= weight;
    let suggestions;
    if (luminance < 0.3) {
      suggestions = ['neon-diary', 'party-flash', 'blue-hour', 'cinema800', 'silver-flash', 'classic-negative'];
    } else if (luminance > 0.68) {
      suggestions = ['peach-portrait', 'sage-daylight', 'paper-matte', 'daily400', 'summer1996', 'sunfaded-slide'];
    } else if (saturation < 0.16) {
      suggestions = ['paper-matte', 'silver-flash', 'milk-tea', 'silver-print', 'classic-negative', 'soft-pastel'];
    } else if (warmth < -0.06) {
      suggestions = ['ccd2004', 'blue-hour', 'sage-daylight', 'green400', 'summer1996', 'silver-print'];
    } else if (warmth > 0.08) {
      suggestions = ['milk-tea', 'amber-hour', 'peach-portrait', 'daily400', 'gold200', 'album1991'];
    } else if (saturation > 0.36) {
      suggestions = ['travel-chrome', 'ccd2004', 'keitai2006', 'school1994', 'half-frame', 'silver-mono'];
    } else {
      suggestions = ['milk-tea', 'paper-matte', 'travel-chrome', 'daily400', 'album1991', 'silver-print'];
    }
    const available = (global.VintageFilters?.presets || []).map((preset) => preset.id).filter((id) => id !== 'original');
    return [...new Set([...suggestions, ...available])].filter((id) => available.includes(id)).slice(0, 6);
  }

  global.VintageEditorCore = Object.freeze({ defaults, normalizeEdits, adjustPixels, render, recommend, orientedSize });
})(window);
