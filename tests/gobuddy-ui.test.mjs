import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "plugins/gobuddy-ui/lib/client.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "electron/main/index.mjs"), "utf8");

test("GoBuddy startup clears the persisted session and enters a fresh conversation", () => {
  assert.match(source, /ctx\.sessions\.clear\(\)/);
  assert.match(source, /ctx\.workspaces\.startSession\(\)/);
  assert.match(source, /snapshot\.baselinesReady/);
});

test("GoBuddy creates an internal workspace when the user has none", () => {
  assert.match(source, /snapshot\.items\.length > 0/);
  assert.match(source, /defaultWorkspace/);
  assert.match(source, /ctx\.workspaces\.create\(\{ path: workspacePath \}\)/);
  assert.match(mainSource, /path\.join\(app\.getPath\("userData"\), "Conversations"\)/);
});

test("GoBuddy exposes the product term 新建对话", () => {
  assert.match(source, /button\.setAttribute\("aria-label", "新建对话"\)/);
  assert.match(source, /label\.textContent = "新建对话"/);
});
