import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SettingsStore, mergeSettings } from "../electron/main/settings.mjs";

test("deep merges settings without dropping nested defaults", () => {
  const merged = mergeSettings(
    { hotkeys: { screenshot: "Ctrl+Shift+S" }, window: { closeBehavior: "quit" } },
    { hotkeys: { screenshot: "Alt+S" } },
  );

  assert.equal(merged.hotkeys.screenshot, "Alt+S");
  assert.equal(merged.window.closeBehavior, "quit");
});

test("loads settings files written with a UTF-8 BOM", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-settings-"));
  const store = new SettingsStore(userDataPath);
  store.ensureDirectories();
  fs.writeFileSync(
    store.settingsPath,
    `\uFEFF${JSON.stringify({ ai: { deepseekApiKey: "test-key" } })}`,
    "utf8",
  );

  const settings = store.load();

  assert.equal(settings.ai.deepseekApiKey, "test-key");
});
