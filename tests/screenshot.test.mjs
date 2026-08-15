import assert from "node:assert/strict";
import { test } from "node:test";
import { findDisplayForRect, getVirtualDisplayBounds } from "../electron/main/screenshot.mjs";

const displays = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, bounds: { x: -1280, y: 120, width: 1280, height: 720 } },
];

test("calculates virtual bounds across negative multi-display coordinates", () => {
  assert.deepEqual(getVirtualDisplayBounds(displays), {
    x: -1280,
    y: 0,
    width: 3200,
    height: 1080,
  });
});

test("finds display from screenshot rect center", () => {
  const display = findDisplayForRect(displays, { x: -900, y: 260, width: 120, height: 80 });
  assert.equal(display.id, 2);
});
