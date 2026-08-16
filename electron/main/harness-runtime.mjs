import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

export const defaultHarnessPackages = {
  dsh: "@deepseek-ai/dsh@0.1.0-rc.6",
  sdk: "@deepseek-ai/dsh-sdk-client@0.0.1-rc.1",
  invariants: "@deepseek-ai/dsh-invariants@^0.1.0-rc.6",
  scope: "@deepseek-ai/dsh-scope@^0.1.0-rc.6",
  fs: "@deepseek-ai/dsh-fs@^0.1.0-rc.6",
  atomicWrite: "@deepseek-ai/dsh-atomic-write@^0.1.0-rc.6",
  bashLocal: "@deepseek-ai/dsh-bash-local@^0.1.0-rc.6",
  shell: "@deepseek-ai/dsh-shell@^0.1.0-rc.6",
  sandbox: "@deepseek-ai/dsh-sandbox@^0.1.0-rc.6",
  compaction: "@deepseek-ai/dsh-compaction@^0.1.0-rc.6",
  workflow: "@deepseek-ai/dsh-workflow@^0.1.0-rc.6",
  codeRuntime: "@deepseek-ai/dsh-code-runtime@^0.1.0-rc.6",
  timeout: "@deepseek-ai/dsh-timeout@^0.1.0-rc.6",
  sessionTelemetry: "@deepseek-ai/dsh-session-telemetry@^0.1.0-rc.6",
  anonymousUserId: "@deepseek-ai/dsh-anonymous-user-id@^0.1.0-rc.6",
  subprocess: "@deepseek-ai/dsh-subprocess@^0.1.0-rc.6",
  sdkProtocol: "@deepseek-ai/dsh-sdk-protocol@^0.0.1-rc.1",
  outputRetention: "@deepseek-ai/dsh-output-retention@^0.1.0-rc.6",
  sessionTitleLlm: "@deepseek-ai/dsh-session-title-llm@^0.1.0-rc.6",
  spill: "@deepseek-ai/dsh-spill@^0.1.0-rc.6",
  subagentDriver: "@deepseek-ai/dsh-subagent-in-process-driver@^0.1.0-rc.6",
  cordisGroup: "@deepseek-ai/cordis-plugin-group@^1.0.1",
};

/** How long to watch for an externally-restarted harness (plugin one-click restart) before recovering on our own. */
const EXTERNAL_RESTART_GRACE_MS = 8000;
/** Poll interval while waiting for an external restart to serve the web client. */
const EXTERNAL_RESTART_POLL_MS = 300;
/** Maximum automatic re-spawns after an unexpected exit within the restart window. */
const AUTO_RESTART_MAX = 2;
/** Restart window for the auto-restart budget. */
const AUTO_RESTART_WINDOW_MS = 30000;
/** HTTP probe timeout when deciding whether a port is served by a Harness web client. */
const PROBE_TIMEOUT_MS = 1500;

export class HarnessRuntimeManager {
  constructor({
    userDataPath,
    sendEvent,
    settingsStore,
    packages = defaultHarnessPackages,
    runtimeDirName = "HarnessRuntime",
    homeDirName = "HarnessHomeManaged",
    bundledRuntimePath = "",
    externalRestartGraceMs = EXTERNAL_RESTART_GRACE_MS,
    externalRestartPollMs = EXTERNAL_RESTART_POLL_MS,
    autoRestartMax = AUTO_RESTART_MAX,
    autoRestartWindowMs = AUTO_RESTART_WINDOW_MS,
  }) {
    this.userDataPath = userDataPath;
    this.writableRuntimePath = path.join(userDataPath, runtimeDirName);
    this.bundledRuntimePath = bundledRuntimePath;
    this.runtimePath = this.resolveRuntimePath();
    this.homePath = path.join(userDataPath, homeDirName);
    this.sendEvent = sendEvent;
    this.settingsStore = settingsStore;
    this.packages = packages;
    this.logPath = path.join(userDataPath, "gobuddy-main.log");
    this.host = "127.0.0.1";
    this.port = 3080;
    this.externalRestartGraceMs = externalRestartGraceMs;
    this.externalRestartPollMs = externalRestartPollMs;
    this.autoRestartMax = autoRestartMax;
    this.autoRestartWindowMs = autoRestartWindowMs;
    this.status = {
      state: "not-installed",
      message: "DeepSeek Harness runtime 尚未安装。",
      installed: false,
      running: false,
      runtimePath: this.runtimePath,
      version: packages.dsh,
    };
    this.process = null;
    this.externalPid = null;
    this.silentProcessExit = false;
    this.terminating = false;
    this.autoRestartCount = 0;
    this.autoRestartWindowStart = 0;
  }

  getStatus() {
    const installed = this.isInstalled();
    const running = this.isRunning();
    return {
      ...this.status,
      installed,
      running,
      state: running ? "running" : installed && this.status.state === "not-installed" ? "available" : this.status.state,
    };
  }

  getClientUrl() {
    return `http://${this.host}:${this.port}/`;
  }

  isRunning() {
    return Boolean((this.process && !this.process.killed) || this.externalPid);
  }

  /**
   * True when something on our host:port serves the DeepSeek Harness web
   * client. The web root embeds a `window.__DSH_BOOT__` bootstrap marker, so
   * this never mistakes an unrelated local web server for the harness.
   */
  async isServedByHarness() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(this.getClientUrl(), { signal: controller.signal });
        if (!response.ok) {
          return false;
        }
        const body = await response.text();
        return body.includes("__DSH_BOOT__");
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  /**
   * PID listening on our host:port, or null. Uses netstat on Windows and
   * lsof on macOS/Linux (both ship with the OS).
   */
  discoverExternalPid() {
    try {
      if (process.platform === "win32") {
        return this.discoverExternalPidWin32();
      }
      return this.discoverExternalPidPosix();
    } catch {
      return null;
    }
  }

  discoverExternalPidWin32() {
    const result = spawnSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !result.stdout) {
      return null;
    }
    const port = String(this.port);
    const listening = /LISTENING\s+(\d+)$/im;
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) {
        continue;
      }
      if (!new RegExp(`(?:127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0|\\[::\\]):${port}\\s`).test(line)) {
        continue;
      }
      const match = listening.exec(line);
      if (match) {
        const pid = Number(match[1]);
        if (pid > 0) {
          return pid;
        }
      }
    }
    return null;
  }

  discoverExternalPidPosix() {
    const result = spawnSync("lsof", ["-nP", `-iTCP:${this.port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) {
      return null;
    }
    // lsof columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    for (const line of result.stdout.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      const pid = Number(columns[1]);
      if (pid > 0) {
        return pid;
      }
    }
    return null;
  }

  /**
   * Adopt a harness that is already serving our web client but was started
   * outside this manager — e.g. the detached replacement process spawned by a
   * plugin's one-click restart. Without adoption GoBuddy would lose track of
   * the restarted harness and could not stop it or report its state.
   * @returns {Promise<boolean>} true when an external harness was adopted.
   */
  async adoptExternalHarness() {
    if (this.process && !this.process.killed) {
      return false;
    }
    if (!(await this.isServedByHarness())) {
      return false;
    }
    const pid = this.discoverExternalPid();
    if (!pid) {
      // The port is served but we cannot resolve the owning process, so the
      // runtime would be marked running without any way to stop it later.
      this.log("harness.external.adopt.skipped", { reason: "no pid on port" });
      return false;
    }
    this.externalPid = pid;
    this.log("harness.external.adopted", { pid, url: this.getClientUrl() });
    this.setStatus("running", "DeepSeek Harness runtime 正在运行（已接管外部重启的进程）。");
    return true;
  }

  /**
   * Seed the web profile with the preset plugin bundles carried by the
   * bundled runtime. The plugins themselves live in the runtime's
   * node_modules (installed at build time by prepare-harness-runtime.mjs),
   * so a profile only needs to declare them in `dsh.profile.bundles` — DSH
   * resolves bundles from the installation anchor first, and the client half
   * resolves from the harness process's own node_modules. This makes every
   * fresh install come with the preset plugins out of the box, with no
   * network or pnpm involved. Existing profiles are only ever appended to
   * (never have bundles removed), so user changes are preserved.
   */
  ensureProfileBundles() {
    const presets = this.readPresetPlugins();
    if (presets.length === 0) {
      return;
    }
    const profileDir = path.join(this.homePath, "profiles", "web");
    const manifestPath = path.join(profileDir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = { name: "dsh-profile-web", private: true, dependencies: {} };
    }
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
      ? [...manifest.dsh.profile.bundles]
      : ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
    let changed = false;
    for (const preset of presets) {
      if (!bundles.includes(preset)) {
        bundles.push(preset);
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    manifest.dsh = {
      ...(manifest.dsh ?? {}),
      profile: {
        ...(manifest.dsh?.profile ?? {}),
        bundles,
      },
    };
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    this.log("harness.profile.seeded", { presets, bundles });
  }

  /**
   * Read the preset plugin list recorded next to the bundled runtime
   * manifest by prepare-harness-runtime.mjs.
   * @returns {string[]} preset plugin package names (empty when absent).
   */
  readPresetPlugins() {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(this.runtimePath, "gobuddy-harness-runtime.json"), "utf8"),
      );
      const presets = manifest.presetPlugins;
      return Array.isArray(presets) ? presets.filter((name) => typeof name === "string") : [];
    } catch {
      return [];
    }
  }

  async install() {
    this.runtimePath = this.resolveRuntimePath();
    if (this.isInstalled()) {
      return this.setStatus("available", "DeepSeek Harness runtime 已安装。");
    }

    this.setStatus("installing", "正在下载 DeepSeek Harness runtime...");
    this.runtimePath = this.writableRuntimePath;
    fs.mkdirSync(this.runtimePath, { recursive: true });

    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", [
      "install",
      "--prefix",
      this.runtimePath,
      "--save-exact",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--legacy-peer-deps",
      ...Object.values(this.packages),
    ], { cwd: this.runtimePath }).catch((error) => {
      this.setStatus("error", `DeepSeek Harness runtime 下载失败：${error.message}`);
      throw error;
    });

    fs.writeFileSync(
      path.join(this.runtimePath, "gobuddy-harness-runtime.json"),
      JSON.stringify({ packages: this.packages, installedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    return this.setStatus("available", "DeepSeek Harness runtime 已准备好。");
  }

  async start() {
    this.log("harness.start.requested", {
      runtimePath: this.runtimePath,
      bundledRuntimePath: this.bundledRuntimePath,
      installed: this.isInstalled(),
    });
    if (this.process && !this.process.killed) {
      return this.setStatus("running", "DeepSeek Harness runtime 正在运行。");
    }

    // A plugin restart leaves a detached harness serving our port. Adopt it
    // instead of spawning a second instance on another port.
    if (await this.adoptExternalHarness()) {
      return this.status;
    }

    if (!this.isInstalled()) {
      await this.install();
    }

    this.setStatus("starting", "正在启动 DeepSeek Harness runtime...");
    this.runtimePath = this.resolveRuntimePath();
    fs.mkdirSync(this.homePath, { recursive: true });
    this.ensureProfileBundles();
    this.port = await findAvailablePort(3080);
    this.terminating = false;
    this.autoRestartCount = 0;
    this.autoRestartWindowStart = 0;
    this.spawnProcess();
    return this.setStatus("running", "DeepSeek Harness runtime 正在运行。");
  }

  spawnProcess() {
    const binPath = path.join(this.runtimePath, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    const command = resolveNodeCommand();
    const aiSettings = this.settingsStore?.load().ai ?? {};
    this.log("harness.start.spawn", {
      command,
      binPath,
      cwd: this.runtimePath,
      homePath: this.homePath,
      profilePath: path.join(this.homePath, "profiles", "web"),
      url: this.getClientUrl(),
      hasDeepSeekApiKey: Boolean(aiSettings.deepseekApiKey || process.env.DEEPSEEK_API_KEY),
      model: aiSettings.model || process.env.DSH_MODEL || "deepseek-chat",
    });
    this.process = spawn(command, [binPath, "web", "--host", this.host, "--port", String(this.port)], {
      cwd: this.runtimePath,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: aiSettings.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "",
        DEEPSEEK_BASE_URL: aiSettings.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        DSH_MODEL: aiSettings.model || process.env.DSH_MODEL || "deepseek-chat",
        DSH_HOME: this.homePath,
        DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || "1",
      },
      windowsHide: true,
    });

    this.silentProcessExit = false;
    this.process.once("error", (error) => {
      this.process = null;
      this.log("harness.process.error", { message: error.message, stack: error.stack });
      if (this.silentProcessExit || this.terminating) {
        return;
      }
      this.setStatus("error", `DeepSeek Harness runtime 启动失败：${error.message}`);
    });
    this.process.once("exit", (code) => {
      this.process = null;
      this.log("harness.process.exit", { code, silent: this.silentProcessExit });
      if (this.silentProcessExit || this.terminating) {
        return;
      }
      void this.handleProcessExit(code);
    });
  }

  /**
   * Recovery after an unexpected harness exit. The startup detection is
   * deliberately decoupled from plugin internals: it only watches whether the
   * web client is served. A plugin's one-click restart kills this process and
   * boots a detached replacement — we wait a short grace window for that
   * replacement to serve the same URL and adopt it. If nothing comes up (e.g.
   * a plugin exception crashed the restarted harness), we re-spawn the harness
   * ourselves, bounded, so a plugin failure can never permanently break the
   * client restart.
   */
  async handleProcessExit(code) {
    this.setStatus("restarting", "DeepSeek Harness runtime 已退出，正在恢复服务...", { notify: false });

    if (await this.waitForExternalRestart()) {
      return;
    }

    if (await this.tryAutoRestart()) {
      return;
    }

    this.log("harness.process.exit.unrecovered", { code });
    this.setStatus(
      "error",
      `DeepSeek Harness runtime 异常退出（${code}）。若由插件异常引起，请禁用最近安装的插件后重试。`,
    );
  }

  async waitForExternalRestart() {
    const deadline = Date.now() + this.externalRestartGraceMs;
    while (Date.now() < deadline) {
      if (this.terminating) {
        return false;
      }
      if (await this.adoptExternalHarness()) {
        return true;
      }
      await sleep(this.externalRestartPollMs);
    }
    return false;
  }

  async tryAutoRestart() {
    const now = Date.now();
    if (now - this.autoRestartWindowStart > this.autoRestartWindowMs) {
      this.autoRestartWindowStart = now;
      this.autoRestartCount = 0;
    }
    if (this.autoRestartCount >= this.autoRestartMax) {
      return false;
    }
    this.autoRestartCount += 1;
    this.log("harness.autoRestart", { attempt: this.autoRestartCount });
    this.setStatus(
      "starting",
      `DeepSeek Harness runtime 异常退出，正在自动重启（${this.autoRestartCount}/${this.autoRestartMax}）...`,
    );
    try {
      this.port = await findAvailablePort(this.port);
      this.spawnProcess();
      return true;
    } catch (error) {
      this.log("harness.autoRestart.spawnError", { message: error.message });
      return false;
    }
  }

  stop({ notify = true } = {}) {
    this.terminating = true;
    if (this.process && !this.process.killed) {
      this.silentProcessExit = !notify;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(this.process.pid), "/t", "/f"], { windowsHide: true });
      } else {
        this.process.kill();
      }
    }
    this.process = null;
    if (this.externalPid) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(this.externalPid), "/t", "/f"], { windowsHide: true });
      } else {
        try {
          process.kill(this.externalPid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      this.externalPid = null;
    }
    return this.setStatus(this.isInstalled() ? "available" : "not-installed", "DeepSeek Harness runtime 已停止。", { notify });
  }

  isInstalled() {
    this.runtimePath = this.resolveRuntimePath();
    return fs.existsSync(path.join(this.runtimePath, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"))
      || fs.existsSync(path.join(this.runtimePath, "node_modules", ".bin"));
  }

  resolveRuntimePath() {
    if (
      this.bundledRuntimePath
      && fs.existsSync(path.join(this.bundledRuntimePath, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"))
    ) {
      return this.bundledRuntimePath;
    }

    return this.writableRuntimePath;
  }

  setStatus(state, message, { notify = true } = {}) {
    this.status = {
      ...this.status,
      state,
      message,
      installed: this.isInstalled(),
      running: this.isRunning(),
      updatedAt: new Date().toISOString(),
    };
    if (notify) {
      this.sendEvent?.("chat:status", this.status);
    }
    return this.status;
  }

  log(event, payload = {}) {
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true });
      fs.appendFileSync(
        this.logPath,
        `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`,
        "utf8",
      );
    } catch {
      // Logging must never block Harness startup.
    }
  }
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: process.platform === "win32", windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`));
      }
    });
  });
}

function resolveNodeCommand() {
  const bundledNodePath = process.resourcesPath
    ? path.join(process.resourcesPath, "node", process.platform === "win32" ? "node.exe" : "node")
    : "";
  if (bundledNodePath && fs.existsSync(bundledNodePath)) {
    return bundledNodePath;
  }

  return process.env.GOBUDDY_NODE_PATH || process.env.npm_node_execpath || "node";
}

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        findAvailablePort(0).then(resolve, reject);
        return;
      }
      reject(error);
    });
    server.listen({ host: "127.0.0.1", port: preferredPort }, () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === "object" && address ? address.port : preferredPort);
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
