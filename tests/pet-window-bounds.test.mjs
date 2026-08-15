import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPetBounds, movePetBounds } from "../electron/main/pet-window-bounds.mjs";

const displays = [
  { workArea: { x: 0, y: 0, width: 1280, height: 720 } },
  { workArea: { x: -1024, y: 0, width: 1024, height: 768 } },
];

test("pet window bounds clamp back into a visible work area", () => {
  const bounds = clampPetBounds({ x: 5000, y: 5000, width: 250, height: 250 }, displays);

  assert.equal(bounds.x, 1030);
  assert.equal(bounds.y, 470);
  assert.equal(bounds.width, 250);
  assert.equal(bounds.height, 250);
});

test("pet window movement remains inside the current display", () => {
  const bounds = movePetBounds({ x: 1200, y: 640, width: 250, height: 250 }, { x: 200, y: 200 }, displays);

  assert.equal(bounds.x, 1030);
  assert.equal(bounds.y, 470);
});
