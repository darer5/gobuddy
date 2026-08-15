import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAccelerator, validateHotkeySet } from "../electron/main/hotkeys.mjs";

test("normalizes Windows style accelerators for Electron", () => {
  assert.equal(normalizeAccelerator("Ctrl+Shift+S"), "CommandOrControl+Shift+S");
  assert.equal(normalizeAccelerator("Alt + V"), "Alt+V");
});

test("validates the screenshot hotkey set", () => {
  assert.deepEqual(validateHotkeySet({ screenshot: "Ctrl+Shift+S" }), { screenshot: "CommandOrControl+Shift+S" });
});
