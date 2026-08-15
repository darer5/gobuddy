export const defaultPetWindowSize = { width: 250, height: 250 };

export function clampPetBounds(bounds, displays, fallbackMargin = 32) {
  const visibleArea = findIntersectingWorkArea(bounds, displays) ?? primaryWorkArea(displays);
  const width = Math.min(bounds.width ?? defaultPetWindowSize.width, visibleArea.width);
  const height = Math.min(bounds.height ?? defaultPetWindowSize.height, visibleArea.height);

  const fallback = {
    x: visibleArea.x + visibleArea.width - width - fallbackMargin,
    y: visibleArea.y + visibleArea.height - height - fallbackMargin,
    width,
    height,
  };

  const x = Number.isFinite(bounds.x) ? bounds.x : fallback.x;
  const y = Number.isFinite(bounds.y) ? bounds.y : fallback.y;

  return {
    x: clamp(x, visibleArea.x, visibleArea.x + visibleArea.width - width),
    y: clamp(y, visibleArea.y, visibleArea.y + visibleArea.height - height),
    width,
    height,
  };
}

export function movePetBounds(bounds, delta, displays) {
  return clampPetBounds({
    ...bounds,
    x: bounds.x + Math.round(delta.x ?? 0),
    y: bounds.y + Math.round(delta.y ?? 0),
  }, displays);
}

function findIntersectingWorkArea(bounds, displays) {
  return displays
    .map((display) => display.workArea ?? display.bounds)
    .find((area) => intersects(bounds, area));
}

function primaryWorkArea(displays) {
  return (displays[0]?.workArea ?? displays[0]?.bounds) ?? { x: 0, y: 0, width: 1280, height: 720 };
}

function intersects(a, b) {
  const width = a.width ?? defaultPetWindowSize.width;
  const height = a.height ?? defaultPetWindowSize.height;
  return a.x < b.x + b.width
    && a.x + width > b.x
    && a.y < b.y + b.height
    && a.y + height > b.y;
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
