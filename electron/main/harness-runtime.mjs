import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

export const defaultHarnessPackages = {
  dsh: "@deepseek-ai/dsh@0.1.0-rc.8",
  sdk: "@deepseek-ai/dsh-sdk-client@0.1.0-rc.8",
  invariants: "@deepseek-ai/dsh-invariants@0.1.0-rc.8",
  scope: "@deepseek-ai/dsh-scope@0.1.0-rc.8",
  fs: "@deepseek-ai/dsh-fs@0.1.0-rc.8",
  atomicWrite: "@deepseek-ai/dsh-atomic-write@0.1.0-rc.8",
  bashLocal: "@deepseek-ai/dsh-bash-local@0.1.0-rc.8",
  shell: "@deepseek-ai/dsh-shell@0.1.0-rc.8",
  sandbox: "@deepseek-ai/dsh-sandbox@0.1.0-rc.8",
  compaction: "@deepseek-ai/dsh-compaction@0.1.0-rc.8",
  workflow: "@deepseek-ai/dsh-workflow@0.1.0-rc.8",
  codeRuntime: "@deepseek-ai/dsh-code-runtime@0.1.0-rc.8",
  timeout: "@deepseek-ai/dsh-timeout@0.1.0-rc.8",
  sessionTelemetry: "@deepseek-ai/dsh-session-telemetry@0.1.0-rc.8",
  anonymousUserId: "@deepseek-ai/dsh-anonymous-user-id@0.1.0-rc.8",
  subprocess: "@deepseek-ai/dsh-subprocess@0.1.0-rc.8",
  sdkProtocol: "@deepseek-ai/dsh-sdk-protocol@0.1.0-rc.8",
  outputRetention: "@deepseek-ai/dsh-output-retention@0.1.0-rc.8",
  sessionTitleLlm: "@deepseek-ai/dsh-session-title-llm@0.1.0-rc.8",
  spill: "@deepseek-ai/dsh-spill@0.1.0-rc.8",
  subagentDriver: "@deepseek-ai/dsh-subagent-in-process-driver@0.1.0-rc.8",
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
const RETIRED_PROFILE_BUNDLES = new Set(["dsh-weread-sidebar"]);

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
    extraEnv = {},
    localPresetPlugins = {},
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
    this.port = resolvePreferredPort(process.env.GOBUDDY_HARNESS_PORT);
    this.externalRestartGraceMs = externalRestartGraceMs;
    this.externalRestartPollMs = externalRestartPollMs;
    this.autoRestartMax = autoRestartMax;
    this.autoRestartWindowMs = autoRestartWindowMs;
    this.extraEnv = extraEnv;
    this.localPresetPlugins = localPresetPlugins;
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
   * network or pnpm involved. Existing profiles keep user bundles; only
   * explicitly retired GoBuddy presets are removed during migration.
   */
  ensureProfileBundles() {
    const presets = this.readPresetPlugins();
    const profileDir = path.join(this.homePath, "profiles", "web");
    const manifestPath = path.join(profileDir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = { name: "dsh-profile-web", private: true, dependencies: {} };
    }
    const previousBundles = Array.isArray(manifest.dsh?.profile?.bundles)
      ? [...manifest.dsh.profile.bundles]
      : ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
    const bundles = previousBundles.filter((name) => !RETIRED_PROFILE_BUNDLES.has(name));
    const seeded = [];
    const skipped = [];
    let changed = bundles.length !== previousBundles.length;
    for (const preset of presets) {
      if (bundles.includes(preset)) {
        // 已在 profile 中声明的插件不再重复追加，也无需重新校验。
        continue;
      }
      if (!this.isUsablePresetPlugin(preset)) {
        // 实体缺失或 package.json 没有 dsh.bundle.patch 的插件必须跳过，
        // 否则 profile boot 会因为坏插件（如 npm 撞名的 aegis@0.1.0）崩溃。
        skipped.push(preset);
        this.log("harness.profile.seedSkipped", { preset, reason: "missing entity or dsh.bundle.patch" });
        continue;
      }
      bundles.push(preset);
      seeded.push(preset);
      changed = true;
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
    for (const retired of RETIRED_PROFILE_BUNDLES) delete manifest.dependencies?.[retired];
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    this.log("harness.profile.seeded", { presets: seeded, skipped, bundles });
  }

  /**
   * DSH 的 healProfilesModuleFallback 只会在 $DSH_HOME/profiles/node_modules
   * 下为 dsh 包自身依赖树里的包建符号链接；preset 插件以 --no-save 装在
   * runtime 的 node_modules，不在那个依赖树里，cordis loader 从 profile
   * 目录解析插件包名时永远找不到它们。这里按同样的机制为每个可用的 preset
   * 插件补建链接，幂等且能修复悬空/错位链接（如 app 被移动后 bundle 路径变化）。
   */
  ensureProfileModuleLinks() {
    const presets = this.readPresetPlugins();
    const linksDir = path.join(this.homePath, "profiles", "node_modules");
    for (const retired of RETIRED_PROFILE_BUNDLES) {
      fs.rmSync(path.join(linksDir, retired), { recursive: true, force: true });
    }
    if (presets.length === 0) {
      return;
    }
    let linked = 0;
    for (const preset of presets) {
      if (!this.isUsablePresetPlugin(preset)) {
        continue;
      }
      const target = path.join(this.runtimePath, "node_modules", preset);
      const link = path.join(linksDir, preset);
      try {
        fs.mkdirSync(path.dirname(link), { recursive: true });
        const valid = (() => {
          try {
            return fs.lstatSync(link).isSymbolicLink()
              && fs.realpathSync(link) === fs.realpathSync(target);
          } catch {
            return false;
          }
        })();
        if (valid) {
          continue;
        }
        fs.rmSync(link, { recursive: true, force: true });
        fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
        linked += 1;
      } catch (error) {
        this.log("harness.profile.linkFailed", { preset, message: error.message });
      }
    }
    if (linked > 0) {
      this.log("harness.profile.linked", { linked });
    }
  }

  /**
   * Source development does not run from electron-builder's extraResources,
   * so copy only explicitly provided in-repo plugins into the managed runtime.
   * Packaged builds pass no entries and continue to use the bundled runtime.
   */
  ensureLocalPresetPlugins() {
    const entries = Object.entries(this.localPresetPlugins ?? {});
    if (entries.length === 0) return;
    const manifestPath = path.join(this.runtimePath, "gobuddy-harness-runtime.json");
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { /* create below */ }
    const presets = new Set(Array.isArray(manifest.presetPlugins) ? manifest.presetPlugins : []);
    for (const retired of RETIRED_PROFILE_BUNDLES) presets.delete(retired);
    for (const [name, source] of entries) {
      if (!fs.existsSync(path.join(source, "package.json"))) {
        this.log("harness.localPreset.missing", { name, source });
        continue;
      }
      const target = path.join(this.runtimePath, "node_modules", name);
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true });
      presets.add(name);
    }
    manifest.presetPlugins = [...presets];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  /**
   * A preset plugin is usable only when its package.json declares
   * `dsh.bundle.patch` and that patch file actually exists. Anything else
   * (missing entity, npm 撞名包) would abort the whole profile boot.
   */
  isUsablePresetPlugin(name) {
    try {
      const pkgDir = path.join(this.runtimePath, "node_modules", name);
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      const patch = pkg.dsh?.bundle?.patch;
      return typeof patch === "string" && patch.length > 0
        && fs.existsSync(path.join(pkgDir, patch));
    } catch {
      return false;
    }
  }

  /**
   * Read the preset plugin list recorded next to the bundled runtime
   * manifest by prepare-harness-runtime.mjs.
   * Falls back to the bundled runtime's manifest when the active runtime has
   * none — an abnormally packaged app may carry the manifest without
   * node_modules, and its plugins then live in the writable runtime instead.
   * @returns {string[]} preset plugin package names (empty when absent).
   */
  readPresetPlugins() {
    const readFrom = (runtimeDir) => {
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(runtimeDir, "gobuddy-harness-runtime.json"), "utf8"),
        );
        const presets = manifest.presetPlugins;
        return Array.isArray(presets) ? presets.filter((name) => typeof name === "string") : [];
      } catch {
        return [];
      }
    };
    const presets = readFrom(this.runtimePath);
    if (presets.length > 0) {
      return presets;
    }
    if (this.bundledRuntimePath && this.bundledRuntimePath !== this.runtimePath) {
      return readFrom(this.bundledRuntimePath);
    }
    return [];
  }

  async install() {
    this.runtimePath = this.resolveRuntimePath();
    if (this.isInstalled()) {
      return this.setStatus("available", "DeepSeek Harness runtime 已安装。");
    }

    this.setStatus("installing", "正在下载 DeepSeek Harness runtime...");
    this.runtimePath = this.writableRuntimePath;
    fs.mkdirSync(this.runtimePath, { recursive: true });

    const { command: npmCommand, binDir } = resolveNpmCommand();
    const npmEnv = { ...process.env };
    if (binDir) {
      // npm 是 shell 脚本（shebang `#!/usr/bin/env node`），GUI 启动的应用
      // PATH 不含 Homebrew/nvm 目录；把 npm 所在目录补进 PATH，避免
      // `spawn npm ENOENT` 以及 env node 找不到。
      npmEnv.PATH = `${binDir}${path.delimiter}${npmEnv.PATH ?? ""}`;
    }
    await runCommand(npmCommand, [
      "install",
      "--prefix",
      this.runtimePath,
      "--save-exact",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--legacy-peer-deps",
      ...Object.values(this.packages),
    ], { cwd: this.runtimePath, env: npmEnv }).catch((error) => {
      const hint = /ENOENT/.test(error.message)
        ? "：未找到 npm。macOS 从桌面启动的应用不会继承 shell 的 PATH；"
          + "请从终端执行一次 `npm run electron`，或设置环境变量 GOBUDDY_NPM_PATH"
          + " 指向 npm 绝对路径（Homebrew Intel 为 /usr/local/bin/npm，Apple Silicon 为 /opt/homebrew/bin/npm）后重试。"
        : "";
      this.setStatus("error", `DeepSeek Harness runtime 下载失败：${error.message}${hint}`);
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
    this.ensureLocalPresetPlugins();
    this.ensureProfileBundles();
    this.ensureProfileModuleLinks();
    this.port = await findAvailablePort(this.port);
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
        ...this.extraEnv,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutTail = "";
    let stderrTail = "";
    this.process.stdout.on("data", (chunk) => {
      stdoutTail = appendOutputTail(stdoutTail, chunk);
    });
    this.process.stderr.on("data", (chunk) => {
      stderrTail = appendOutputTail(stderrTail, chunk);
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
    this.process.once("exit", (code, signal) => {
      this.process = null;
      this.log("harness.process.exit", {
        code,
        signal,
        stdoutTail: stdoutTail.trim(),
        stderrTail: stderrTail.trim(),
        silent: this.silentProcessExit,
      });
      if (this.silentProcessExit || this.terminating) {
        return;
      }
      void this.handleProcessExit(code, signal);
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
  async handleProcessExit(code, signal = null) {
    this.setStatus("restarting", "DeepSeek Harness runtime 已退出，正在恢复服务...", { notify: false });

    if (await this.waitForExternalRestart()) {
      return;
    }

    if (await this.tryAutoRestart()) {
      return;
    }

    this.log("harness.process.exit.unrecovered", { code, signal });
    const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
    this.setStatus(
      "error",
      `DeepSeek Harness runtime 异常退出（${reason}）。详情请查看 gobuddy-main.log。`,
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

/**
 * Resolve an npm executable for the writable-runtime install fallback.
 * macOS GUI-launched apps inherit only the system default PATH (no Homebrew /
 * nvm directories), so spawning bare `npm` fails with ENOENT. Prefer an
 * explicit GOBUDDY_NPM_PATH, then probe the well-known Homebrew locations
 * before falling back to a PATH lookup.
 * @returns {{command: string, binDir: string | null}}
 */
function resolveNpmCommand() {
  const explicit = process.env.GOBUDDY_NPM_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return { command: explicit, binDir: path.dirname(explicit) };
  }
  if (process.platform === "darwin") {
    for (const candidate of ["/opt/homebrew/bin/npm", "/usr/local/bin/npm"]) {
      if (fs.existsSync(candidate)) {
        return { command: candidate, binDir: path.dirname(candidate) };
      }
    }
  }
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", binDir: null };
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

function resolvePreferredPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 3080;
}

function appendOutputTail(current, chunk, maxLength = 4000) {
  const combined = current + chunk.toString();
  return combined.length > maxLength ? combined.slice(-maxLength) : combined;
}
