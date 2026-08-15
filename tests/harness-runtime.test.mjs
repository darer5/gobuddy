import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HarnessRuntimeManager } from "../electron/main/harness-runtime.mjs";

test("harness runtime reports not-installed before runtime exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const runtime = new HarnessRuntimeManager({ userDataPath: dir });

  const status = runtime.getStatus();
  assert.equal(status.state, "not-installed");
  assert.equal(status.installed, false);
});

test("harness runtime reports available when node_modules bin exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  fs.mkdirSync(path.join(dir, "HarnessRuntime", "node_modules", ".bin"), { recursive: true });
  const runtime = new HarnessRuntimeManager({ userDataPath: dir });

  const status = runtime.getStatus();
  assert.equal(status.state, "available");
  assert.equal(status.installed, true);
});

test("harness runtime silent stop does not emit shutdown status", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const binPath = path.join(dir, "HarnessRuntime", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, "setInterval(() => {}, 1000);\n", "utf8");

  const events = [];
  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    sendEvent: (event, payload) => events.push({ event, payload }),
    settingsStore: { load: () => ({ ai: {} }) },
  });

  await runtime.start();
  events.length = 0;
  runtime.stop({ notify: false });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.deepEqual(events, []);
});
