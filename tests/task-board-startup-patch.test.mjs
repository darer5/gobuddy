import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  TASK_BOARD_STARTUP_PATCH_MARKER,
  TASK_BOARD_ICON_PATCH_MARKER,
  TASK_BOARD_EXCLUSIVE_PANEL_PATCH_MARKER,
  patchTaskBoardExclusivePanel,
  patchTaskBoardIcon,
  patchTaskBoardStartup,
  syncDirectoryPresetPlugins,
} from "../scripts/harness-runtime-utils.mjs";

const schedulerAnchor = `
			start() {
				if (this.disposed) return;
				if (this.started) return;
				this.started = true;
				this.tick();
				this.timer = setInterval(() => {
					this.tick();
				}, this.deps.tickMs ?? 6e4);
			}
`;
const temporaryRuntimes = [];
const iconAnchor = 'const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>`;';
const exclusivePanelAnchor = 'if (event.detail === "ssh" && controller.getSnapshot().boardOpen) controller.closeBoard();';

after(() => {
  for (const runtimeDir of temporaryRuntimes) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("task-board startup patch skips missed cron runs without disabling its timer", () => {
  const runtimeDir = makeRuntime(schedulerAnchor);

  assert.equal(patchTaskBoardStartup(runtimeDir), true);
  const patched = readBundle(runtimeDir);

  assert.match(patched, new RegExp(TASK_BOARD_STARTUP_PATCH_MARKER));
  assert.doesNotMatch(patched, /this\.started = true;\n\s*this\.tick\(\);/);
  assert.match(patched, /nextRunAtMs\(schedule\.cron, now\)/);
  assert.match(patched, /this\.timer = setInterval/);
});

test("task-board startup patch is idempotent", () => {
  const runtimeDir = makeRuntime(schedulerAnchor);

  assert.equal(patchTaskBoardStartup(runtimeDir), true);
  const once = readBundle(runtimeDir);
  assert.equal(patchTaskBoardStartup(runtimeDir), false);
  assert.equal(readBundle(runtimeDir), once);
});

test("task-board startup patch fails closed when the upstream bundle changes", () => {
  const runtimeDir = makeRuntime("export const changedUpstream = true;\n");

  assert.throws(
    () => patchTaskBoardStartup(runtimeDir),
    /expected one scheduler anchor, found 0/,
  );
});

test("task-board icon patch uses the same 24px Fluent style as Harness", () => {
  const runtimeDir = makeRuntime(iconAnchor);
  assert.equal(patchTaskBoardIcon(runtimeDir), true);
  const patched = readBundle(runtimeDir);
  assert.match(patched, new RegExp(TASK_BOARD_ICON_PATCH_MARKER));
  assert.match(patched, /viewBox="0 0 24 24" width="24" height="24" fill="currentColor"/);
  assert.equal(patchTaskBoardIcon(runtimeDir), false);
});

test("task-board closes for every other exclusive panel", () => {
  const runtimeDir = makeRuntime(exclusivePanelAnchor);
  assert.equal(patchTaskBoardExclusivePanel(runtimeDir), true);
  const patched = readBundle(runtimeDir);
  assert.match(patched, new RegExp(TASK_BOARD_EXCLUSIVE_PANEL_PATCH_MARKER));
  assert.match(patched, /event\.detail !== PANEL_NAME/);
  assert.equal(patchTaskBoardExclusivePanel(runtimeDir), false);
});

test("runtime preparation refreshes changed directory-backed plugins", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-local-plugin-"));
  temporaryRuntimes.push(root);
  const runtimeDir = path.join(root, "runtime");
  const pluginDir = path.join(root, "plugins", "example");
  const installedDir = path.join(runtimeDir, "node_modules", "example-plugin");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(installedDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), '{"name":"example-plugin"}', "utf8");
  fs.writeFileSync(path.join(pluginDir, "client.js"), "new-client", "utf8");
  fs.writeFileSync(path.join(installedDir, "client.js"), "stale-client", "utf8");

  const synced = syncDirectoryPresetPlugins(runtimeDir, root, {
    "example-plugin": "file:plugins/example",
    "archive-plugin": "file:plugins/archive.tgz",
    "npm-plugin": "1.0.0",
  });

  assert.deepEqual(synced, ["example-plugin"]);
  assert.equal(fs.readFileSync(path.join(installedDir, "client.js"), "utf8"), "new-client");
});

function makeRuntime(bundle) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-task-board-"));
  temporaryRuntimes.push(runtimeDir);
  const bundlePath = bundlePathFor(runtimeDir);
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, bundle, "utf8");
  return runtimeDir;
}

function readBundle(runtimeDir) {
  return fs.readFileSync(bundlePathFor(runtimeDir), "utf8");
}

function bundlePathFor(runtimeDir) {
  return path.join(
    runtimeDir,
    "node_modules",
    "@linxin666",
    "dsh-client-ui-task-board",
    "lib",
    "client.js",
  );
}
