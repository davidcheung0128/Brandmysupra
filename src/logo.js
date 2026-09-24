const ALPHA_CUTOFF = 8;

export async function prepareLogo(file) {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
  if (!allowed.has(file.type)) throw new Error("Upload a PNG, JPG, WebP, or SVG logo");
  if (file.size > 10 * 1024 * 1024) throw new Error("Logo files must be smaller than 10 MB");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] < ALPHA_CUTOFF) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left) throw new Error("The uploaded logo is empty");

    const padding = 4;
    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(canvas.width - 1, right + padding);
    bottom = Math.min(canvas.height - 1, bottom + padding);

    const trimmed = document.createElement("canvas");
    trimmed.width = right - left + 1;
    trimmed.height = bottom - top + 1;
    const trimmedCtx = trimmed.getContext("2d", { willReadFrequently: true });
    trimmedCtx.drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);

    const hull = alphaConvexHull(trimmed);
    const blob = await new Promise((resolve, reject) => {
      trimmed.toBlob((value) => (value ? resolve(value) : reject(new Error("Could not process this logo"))), "image/png");
    });

    return {
      url: URL.createObjectURL(blob),
      width: trimmed.width,
      height: trimmed.height,
      aspect: trimmed.width / trimmed.height,
      hull,
      canvas: trimmed,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/** Monotone-chain convex hull of opaque pixels, normalized to 0–1 logo space. */
export function alphaConvexHull(canvas, { step = 3, alphaCutoff = ALPHA_CUTOFF } = {}) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const points = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] >= alphaCutoff) points.push([x, y]);
    }
  }
  if (points.length < 3) {
    return [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
  }

  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.map(([x, y]) => [x / width, y / height]);
}

/** Four handle points: extremes of the alpha hull in logo UV space. */
export function hullHandlePoints(hull) {
  if (!hull?.length) {
    return [
      [0, 0.5],
      [1, 0.5],
      [0.5, 0],
      [0.5, 1],
    ];
  }
  let left = hull[0];
  let right = hull[0];
  let top = hull[0];
  let bottom = hull[0];
  for (const point of hull) {
    if (point[0] < left[0]) left = point;
    if (point[0] > right[0]) right = point;
    if (point[1] < top[1]) top = point;
    if (point[1] > bottom[1]) bottom = point;
  }
  return [left, right, top, bottom];
}

export function logoWorldSize(aspect, maxWidth, maxHeight, scale) {
  let width = maxWidth * scale;
  let height = width / (aspect || 1);
  if (height > maxHeight * scale) {
    height = maxHeight * scale;
    width = height * (aspect || 1);
  }
  return { width: Math.max(width, 0.08), height: Math.max(height, 0.08) };
}

/**
 * Draw one placement into a transparent UV atlas canvas for a body-paint mesh.
 * Uses mesh UV center + world size converted through triangle UV density.
 */
export async function bakePlacementToAtlas({
  placement,
  logoUrl,
  uPerMeter,
  vPerMeter,
  atlasSize = 2048,
  existingCanvas = null,
}) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = logoUrl;
  await image.decode();

  const canvas = existingCanvas || document.createElement("canvas");
  if (!existingCanvas) {
    canvas.width = atlasSize;
    canvas.height = atlasSize;
  }
  const context = canvas.getContext("2d");
  if (!existingCanvas) context.clearRect(0, 0, atlasSize, atlasSize);

  const aspect = image.width / image.height || 1;
  const worldWidth = 0.55 * placement.scale;
  const worldHeight = worldWidth / aspect;
  const uvW = Math.max(0.01, worldWidth * uPerMeter);
  const uvH = Math.max(0.01, worldHeight * vPerMeter);
  const [u, v] = placement.uvCenter;
  const cx = u * atlasSize;
  const cy = (1 - v) * atlasSize;
  const pixelW = uvW * atlasSize;
  const pixelH = uvH * atlasSize;

  context.save();
  context.translate(cx, cy);
  context.rotate(-placement.rotation);
  context.drawImage(image, -pixelW / 2, -pixelH / 2, pixelW, pixelH);
  context.restore();
  return canvas;
}

export function canvasToObjectUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not bake this logo"));
      else resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
}
