import fs from "node:fs";
import path from "node:path";
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

export class HarnessRuntimeManager {
  constructor({ userDataPath, sendEvent, settingsStore, packages = defaultHarnessPackages, runtimeDirName = "HarnessRuntime", bundledRuntimePath = "" }) {
    this.userDataPath = userDataPath;
    this.writableRuntimePath = path.join(userDataPath, runtimeDirName);
    this.bundledRuntimePath = bundledRuntimePath;
    this.runtimePath = this.resolveRuntimePath();
    this.homePath = path.join(userDataPath, "HarnessHome");
    this.sendEvent = sendEvent;
    this.settingsStore = settingsStore;
    this.packages = packages;
    this.logPath = path.join(userDataPath, "gobuddy-main.log");
    this.status = {
      state: "not-installed",
      message: "DeepSeek Harness runtime 尚未安装。",
      installed: false,
      running: false,
      runtimePath: this.runtimePath,
      version: packages.dsh,
    };
    this.process = null;
    this.silentProcessExit = false;
  }

  getStatus() {
    const installed = this.isInstalled();
    return {
      ...this.status,
      installed,
      running: Boolean(this.process && !this.process.killed),
      state: this.process && !this.process.killed ? "running" : installed && this.status.state === "not-installed" ? "available" : this.status.state,
    };
  }

  async install() {
    this.runtimePath = this.resolveRuntimePath();
    if (this.isInstalled()) {
      return this.setStatus("available", "DeepSeek Harness runtime 已安装。");
    }

    this.setStatus("installing", "正在下载 DeepSeek Harness runtime...");
    this.runtimePath = this.writableRuntimePath;
    fs.mkdirSync(this.runtimePath, { recursive: true });

    await runCommand("npm.cmd", [
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

    if (!this.isInstalled()) {
      await this.install();
    }

    this.setStatus("starting", "正在启动 DeepSeek Harness runtime...");
    this.runtimePath = this.resolveRuntimePath();
    fs.mkdirSync(this.homePath, { recursive: true });
    const binPath = path.join(this.runtimePath, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    const command = resolveNodeCommand();
    const aiSettings = this.settingsStore?.load().ai ?? {};
    this.log("harness.start.spawn", {
      command,
      binPath,
      cwd: this.runtimePath,
      homePath: this.homePath,
      hasDeepSeekApiKey: Boolean(aiSettings.deepseekApiKey || process.env.DEEPSEEK_API_KEY),
      model: aiSettings.model || process.env.DSH_MODEL || "deepseek-chat",
    });
    this.process = spawn(command, [binPath, "web", "--host", "127.0.0.1", "--port", "3080"], {
      cwd: this.runtimePath,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: aiSettings.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "",
        DEEPSEEK_BASE_URL: aiSettings.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        DSH_MODEL: aiSettings.model || process.env.DSH_MODEL || "deepseek-chat",
        DSH_HOME: this.homePath,
      },
      windowsHide: true,
    });

    this.silentProcessExit = false;
    this.process.once("error", (error) => {
      this.process = null;
      this.log("harness.process.error", { message: error.message, stack: error.stack });
      if (this.silentProcessExit) {
        return;
      }
      this.setStatus("error", `DeepSeek Harness runtime 启动失败：${error.message}`);
    });
    this.process.once("exit", (code) => {
      this.process = null;
      this.log("harness.process.exit", { code, silent: this.silentProcessExit });
      if (this.silentProcessExit) {
        return;
      }
      this.setStatus(code === 0 ? "available" : "error", code === 0 ? "DeepSeek Harness runtime 已停止。" : `DeepSeek Harness runtime 异常退出：${code}`);
    });

    return this.setStatus("running", "DeepSeek Harness runtime 正在运行。");
  }

  stop({ notify = true } = {}) {
    if (this.process && !this.process.killed) {
      this.silentProcessExit = !notify;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(this.process.pid), "/t", "/f"], { windowsHide: true });
      } else {
        this.process.kill();
      }
    }
    this.process = null;
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
      running: Boolean(this.process && !this.process.killed),
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
