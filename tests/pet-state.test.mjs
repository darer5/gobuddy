import assert from "node:assert/strict";
import { test } from "node:test";
import { getPetActionProfile, PetStateMachine, petModes, resolvePetMode } from "../electron/main/pet-state.mjs";

test("pet state maps clipboard work events to dedicated actions", () => {
  const machine = new PetStateMachine();
  const state = machine.setMode("clipboard-image");

  assert.equal(state.mode, "clipboard-image");
  assert.equal(state.expression, "happy");
  assert.equal(state.animation, "pop");
  assert.equal(machine.tick(state.updatedAt + 3000).mode, "idle");
});

test("pet state maps screenshot lifecycle to dedicated actions", () => {
  const machine = new PetStateMachine();

  assert.equal(machine.setMode("screenshot-start").mode, "screenshot-start");
  assert.equal(machine.setMode("screenshot-success").mode, "screenshot-success");
  assert.equal(machine.tick(Date.now() + 4000).mode, "idle");
  assert.equal(machine.setMode("screenshot-cancel").mode, "screenshot-cancel");
});

test("drag state cannot be interrupted by ambient actions", () => {
  const machine = new PetStateMachine();
  machine.setMode("drag");

  assert.equal(machine.canInterruptWith("blink"), false);
  assert.equal(machine.canInterruptWith("clipboard-text"), false);
  assert.equal(machine.canInterruptWith("screenshot-success"), true);
});

test("legacy pet modes resolve to supported work companion modes", () => {
  assert.equal(resolvePetMode("clipboard"), "clipboard-text");
  assert.equal(resolvePetMode("screenshot"), "screenshot-success");
  assert.equal(resolvePetMode("curious"), "look");
});

test("single-click open-main mode has happy expression and high priority", () => {
  const machine = new PetStateMachine();
  const state = machine.setMode("main-open", "主页面已打开。");

  assert.equal(state.mode, "main-open");
  assert.equal(state.expression, "happy");
  assert.equal(state.animation, "jump");
  assert.equal(machine.canInterruptWith("idle"), false);
});

test("all pet modes have action profiles for renderer animation", () => {
  for (const mode of petModes) {
    const profile = getPetActionProfile(mode);
    assert.ok(profile.expression, `${mode} missing expression`);
    assert.ok(profile.animation, `${mode} missing animation`);
    assert.equal(typeof profile.durationMs, "number");
  }
});
