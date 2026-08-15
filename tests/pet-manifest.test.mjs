import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadPetManifest, validatePetManifest } from "../electron/main/pet-manifest.mjs";

const publicPath = path.join(process.cwd(), "public");

test("pet manifest defines required work companion actions with existing frames", () => {
  const manifest = loadPetManifest(publicPath);

  for (const mode of [
    "idle",
    "blink",
    "look",
    "poke",
    "drag",
    "sleep",
    "clipboard-text",
    "clipboard-image",
    "screenshot-start",
    "screenshot-success",
    "screenshot-cancel",
  ]) {
    assert.ok(manifest.actions[mode], `${mode} missing from manifest`);
    assert.equal(manifest.actions[mode].hasFrames, true, `${mode} has no usable frames`);
  }
});

test("pet manifest validation reports missing frame definitions", () => {
  const problems = validatePetManifest({
    actions: [{ mode: "idle", priority: 0, durationMs: 0, loop: true, fps: 1, hitbox: { width: 10, height: 10 }, message: "idle" }],
  });

  assert.ok(problems.some((problem) => problem.includes("frames")));
});
