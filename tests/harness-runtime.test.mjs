import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

test("harness runtime starts with an isolated managed DSH home", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const binPath = path.join(dir, "HarnessRuntime", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const envPath = path.join(dir, "dsh-home.txt");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(
    binPath,
    `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(envPath)}, process.env.DSH_HOME ?? "", "utf8");\nsetInterval(() => {}, 1000);\n`,
    "utf8",
  );

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    settingsStore: { load: () => ({ ai: {} }) },
  });

  await runtime.start();
  await waitForFile(envPath);
  runtime.stop({ notify: false });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(fs.readFileSync(envPath, "utf8"), path.join(dir, "HarnessHomeManaged"));
});

test("harness runtime avoids an occupied default web port", async () => {
  const occupied = await listenOnPort(3080);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const binPath = path.join(dir, "HarnessRuntime", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const argsPath = path.join(dir, "args.json");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(
    binPath,
    `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)), "utf8");\nsetInterval(() => {}, 1000);\n`,
    "utf8",
  );

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    settingsStore: { load: () => ({ ai: {} }) },
  });

  try {
    await runtime.start();
    await waitForFile(argsPath);
    const args = JSON.parse(fs.readFileSync(argsPath, "utf8"));
    const port = Number(args[args.indexOf("--port") + 1]);
    assert.notEqual(port, 3080);
    assert.match(runtime.getClientUrl(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
  } finally {
    runtime.stop({ notify: false });
    occupied.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

test("harness runtime adopts an externally restarted harness on the same port", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const binPath = writeServingHarnessScript(dir);

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    settingsStore: { load: () => ({ ai: {} }) },
    externalRestartGraceMs: 5000,
    externalRestartPollMs: 100,
  });

  try {
    await runtime.start();
    await waitForFile(path.join(dir, "pid.txt"));
    const managedPid = Number(fs.readFileSync(path.join(dir, "pid.txt"), "utf8"));
    const port = runtime.port;
    assert.ok(managedPid > 0);

    // A plugin restart kills the managed process and boots a detached
    // replacement serving the same port.
    killProcessTree(managedPid);
    const external = spawnExternalHarness(binPath, port);
    await waitForFile(path.join(dir, "external-pid.txt"));
    const externalPid = Number(fs.readFileSync(path.join(dir, "external-pid.txt"), "utf8"));

    await waitForCondition(() => runtime.isRunning() && runtime.externalPid === externalPid, 6000);
    assert.equal(runtime.getStatus().state, "running");
    assert.equal(runtime.externalPid, externalPid);
    assert.equal(runtime.getClientUrl(), `http://127.0.0.1:${port}/`);

    // GoBuddy must be able to stop the adopted external process.
    runtime.stop({ notify: false });
    await waitForCondition(() => !isProcessAlive(externalPid), 4000);
    external.unref();
  } finally {
    runtime.stop({ notify: false });
  }
});

test("harness runtime adopts a harness already serving on start", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const binPath = writeServingHarnessScript(dir);
  const port = await getFreePort();

  const external = spawnExternalHarness(binPath, port);
  await waitForFile(path.join(dir, "external-pid.txt"));
  const externalPid = Number(fs.readFileSync(path.join(dir, "external-pid.txt"), "utf8"));

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    settingsStore: { load: () => ({ ai: {} }) },
  });
  runtime.port = port;

  try {
    await runtime.start();
    assert.equal(runtime.getStatus().state, "running");
    assert.equal(runtime.process, null);
    assert.equal(runtime.externalPid, externalPid);
    assert.equal(runtime.getClientUrl(), `http://127.0.0.1:${port}/`);
  } finally {
    runtime.stop({ notify: false });
    await waitForCondition(() => !isProcessAlive(externalPid), 4000);
    external.unref();
  }
});

test("harness runtime does not adopt an external harness without a resolvable pid", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const runtime = new HarnessRuntimeManager({ userDataPath: dir });
  runtime.isServedByHarness = async () => true;
  runtime.discoverExternalPid = () => null;

  assert.equal(await runtime.adoptExternalHarness(), false);
  assert.equal(runtime.externalPid, null);
  assert.notEqual(runtime.getStatus().state, "running");
});

test("harness runtime auto-restarts after a crash and reports error when the budget is exhausted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const spawnsPath = path.join(dir, "spawns.txt");
  const binPath = path.join(dir, "HarnessRuntime", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(
    binPath,
    `const fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(spawnsPath)}, "spawn\\n", "utf8");\nprocess.exit(1);\n`,
    "utf8",
  );

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    settingsStore: { load: () => ({ ai: {} }) },
    externalRestartGraceMs: 150,
    externalRestartPollMs: 30,
    autoRestartMax: 1,
    autoRestartWindowMs: 5000,
  });

  await runtime.start();
  await waitForCondition(() => runtime.getStatus().state === "error", 8000);

  const spawns = fs.readFileSync(spawnsPath, "utf8").trim().split("\n");
  assert.equal(spawns.length, 2, "initial spawn plus one auto-restart");
  assert.match(runtime.status.message, /插件/);
});

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      // This server only exists to occupy the port. Destroy probe connections
      // immediately so they cannot leak past the test and keep the test
      // process alive after the suite finishes.
      socket.destroy();
    });
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => resolve(server));
  });
}

async function waitForFile(filePath, timeoutMs = 4000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForCondition(condition, timeoutMs = 4000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/**
 * A fake harness bin.js that serves the DSH web-client bootstrap marker
 * (`window.__DSH_BOOT__`) on the --port argument and records the PID of
 * whoever starts it. The PID file lets tests tell the managed process apart
 * from an externally restarted one.
 */
function writeServingHarnessScript(dir) {
  const binPath = path.join(dir, "HarnessRuntime", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  const pidPath = JSON.stringify(path.join(dir, "pid.txt"));
  const externalPidPath = JSON.stringify(path.join(dir, "external-pid.txt"));
  fs.writeFileSync(
    binPath,
    `const http = require("node:http");
const fs = require("node:fs");
const portArg = process.argv[process.argv.indexOf("--port") + 1];
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><html><body><script>window.__DSH_BOOT__={}</script></body></html>");
});
server.listen(Number(portArg), "127.0.0.1", () => {
  fs.writeFileSync(${pidPath}, String(process.pid), "utf8");
  if (process.env.DSH_EXTERNAL_RESTART === "1") {
    fs.writeFileSync(${externalPidPath}, String(process.pid), "utf8");
  }
});
setInterval(() => {}, 1000);
`,
    "utf8",
  );
  return binPath;
}

function spawnExternalHarness(binPath, port) {
  const child = spawn(process.execPath, [binPath, "web", "--host", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, DSH_EXTERNAL_RESTART: "1" },
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

function killProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("ensureProfileBundles seeds preset plugins into a fresh profile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const runtimePath = path.join(dir, "HarnessRuntimeManaged");
  fs.mkdirSync(runtimePath, { recursive: true });
  fs.writeFileSync(
    path.join(runtimePath, "gobuddy-harness-runtime.json"),
    JSON.stringify({ presetPlugins: ["dsh-better-sidebar", "dshmarket", "dsh-global-rules"] }),
    "utf8",
  );

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    runtimeDirName: "HarnessRuntimeManaged",
    homeDirName: "HarnessHomeManaged",
  });
  runtime.runtimePath = runtimePath;
  runtime.ensureProfileBundles();

  const manifestPath = path.join(dir, "HarnessHomeManaged", "profiles", "web", "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dsh-better-sidebar",
    "dshmarket",
    "dsh-global-rules",
  ]);
});

test("ensureProfileBundles appends only missing presets, preserving user bundles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const runtimePath = path.join(dir, "HarnessRuntimeManaged");
  fs.mkdirSync(runtimePath, { recursive: true });
  fs.writeFileSync(
    path.join(runtimePath, "gobuddy-harness-runtime.json"),
    JSON.stringify({ presetPlugins: ["dsh-better-sidebar", "dshmarket"] }),
    "utf8",
  );

  const profileDir = path.join(dir, "HarnessHomeManaged", "profiles", "web");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "package.json"),
    JSON.stringify({
      name: "dsh-profile-web",
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "my-custom-plugin", "dshmarket"] } },
    }),
    "utf8",
  );

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    runtimeDirName: "HarnessRuntimeManaged",
    homeDirName: "HarnessHomeManaged",
  });
  runtime.runtimePath = runtimePath;
  runtime.ensureProfileBundles();

  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "my-custom-plugin",
    "dshmarket",
    "dsh-better-sidebar",
  ]);
});

test("ensureProfileBundles is a no-op without preset plugins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const runtimePath = path.join(dir, "HarnessRuntimeManaged");
  fs.mkdirSync(runtimePath, { recursive: true });
  fs.writeFileSync(path.join(runtimePath, "gobuddy-harness-runtime.json"), JSON.stringify({}), "utf8");

  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    runtimeDirName: "HarnessRuntimeManaged",
    homeDirName: "HarnessHomeManaged",
  });
  runtime.runtimePath = runtimePath;
  runtime.ensureProfileBundles();

  assert.equal(fs.existsSync(path.join(dir, "HarnessHomeManaged", "profiles", "web", "package.json")), false);
});

test("readPresetPlugins returns empty when manifest is missing or malformed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-harness-"));
  const runtime = new HarnessRuntimeManager({
    userDataPath: dir,
    runtimeDirName: "HarnessRuntimeManaged",
    homeDirName: "HarnessHomeManaged",
  });
  runtime.runtimePath = path.join(dir, "HarnessRuntimeManaged");
  assert.deepEqual(runtime.readPresetPlugins(), []);
});
