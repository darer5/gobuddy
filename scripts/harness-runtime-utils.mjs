import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { defaultHarnessPackages } from "../electron/main/harness-runtime.mjs";

/**
 * Shared helpers for building the bundled DeepSeek Harness runtime
 * (vendor/HarnessRuntimeManaged) on any platform. Used by both
 * prepare-harness-runtime.mjs (copy from an existing runtime) and
 * bootstrap-harness-runtime.mjs (install from scratch) so the two paths
 * never drift apart.
 */

/**
 * Plugins bundled into the Harness runtime and auto-mounted into every new
 * web profile. Key = npm package name, value = exact version (or npm range)
 * pinned at build time. Installing into the runtime's own node_modules lets
 * DSH resolve them as profile bundles without any profile-local install:
 * `resolveBundleDir` prefers the installation anchor, and the client half
 * resolves from the harness process's node_modules.
 */
export const PRESET_PLUGINS = {
  // 与用户给出的无版本安装命令保持一致；sidebar-qa@0.4.0 要求 >=0.14.0。
  "dsh-better-sidebar": "0.15.1",
  "dsh-sidebar-qa": "git+https://github.com/ChenRuoT/dsh-sidebar-qa.git",
  "@huanlin/dsh-plugin-better-sidebar-plugin-office": "0.1.0",
  "dshmarket": "1.8.0",
  "dsh-global-rules": "0.1.0",
  "@anionex/dsh-vision-toolkit": "0.1.7",
  "@linxin666/dsh-client-ui-git-graph": "0.1.17",
  "@linxin666/dsh-client-ui-task-board": "0.1.17",
  "@linxin666/dsh-live-stats": "0.1.17",
  "@zseven-w/dsh-openpencil": "0.1.0-rc.1",
  "@dsh-external/dsh-visualize": "github:Nagi-ovo/dsh-visualize",
  "@omdsh-dev/dsh-annotation": "github:omdsh-dev/dsh-annotation",
  // dsh-at-file 仓库的 devDependencies 用了 pnpm link: 协议，npm 直接装 git 源
  // 会失败；使用由已安装包打包的 tgz（运行时依赖 zod 由 dsh 运行时提供）。
  "dsh-at-file": "file:plugins/dsh-at-file-0.6.0.tgz",
  "dsh-file-uploads": "github:l541402398/dsh-file-uploads#main",
  // 仓库内源码插件：用 file: 相对仓库根目录的路径（见 installPresetPlugins）。
  "gobuddy-ui": "file:plugins/gobuddy-ui",
  "dsh-web-canvas": "file:plugins/dsh-web-canvas",
  "graph-memory": "file:plugins/graph-memory-1.6.0-beta.1.tgz",
  // 注意：不要用裸包名 "aegis" 指代插件。npm 上的 aegis@0.1.0 是一个无关的
  // 2012 年老库（killdream/aegis），没有 dsh.bundle 声明，profile boot 会直接
  // 崩溃（"declares no dsh.bundle in its package.json"）。若 aegis 插件有正确
  // 的发布源（如 GitHub 仓库），请显式写完整 spec 后再加回。
};

// task-board@0.1.17 在浏览器启动时立即执行 tick()，会把应用关闭期间
// 错过的 cron 时间当成待补跑任务。若上次运行中断，用户每次启动 GoBuddy
// 都会看到同一条 prompt 被自动提交。当前 Harness 仍是 0.1.0-rc.8，不能
// 直接升级到要求 Harness >=0.1.1 的新版 task-board，因此在打包阶段应用
// 一个受严格锚点保护的兼容补丁：启动时只把过期时间滚到未来，不执行任务。
export const TASK_BOARD_STARTUP_PATCH_MARKER = "GoBuddy: skip missed task runs on startup";
export const TASK_BOARD_ICON_PATCH_MARKER = "GoBuddy Fluent Board24Regular";
export const TASK_BOARD_EXCLUSIVE_PANEL_PATCH_MARKER = "GoBuddy: close task board when another panel activates";

/**
 * Patch task-board's compiled browser bundle so application startup never
 * replays cron instants missed while GoBuddy was closed. Manual runs and cron
 * instants reached while the application remains open are unchanged.
 */
export function patchTaskBoardStartup(runtimeDir) {
  const bundlePath = path.join(
    runtimeDir,
    "node_modules",
    "@linxin666",
    "dsh-client-ui-task-board",
    "lib",
    "client.js",
  );
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Task-board client bundle missing: ${bundlePath}`);
  }

  const source = fs.readFileSync(bundlePath, "utf8");
  if (source.includes(TASK_BOARD_STARTUP_PATCH_MARKER)) return false;

  const anchor = `\t\t\t\tthis.started = true;\n\t\t\t\tthis.tick();\n\t\t\t\tthis.timer = setInterval(() => {`;
  const replacement = `\t\t\t\tthis.started = true;\n\t\t\t\t// ${TASK_BOARD_STARTUP_PATCH_MARKER}\n\t\t\t\tconst now = this.deps.now();\n\t\t\t\tfor (const task of this.deps.tasks()) {\n\t\t\t\t\tconst schedule = task.schedule;\n\t\t\t\t\tif (schedule === void 0 || !schedule.enabled) continue;\n\t\t\t\t\tif (schedule.nextRunAt !== void 0 && schedule.nextRunAt > now) continue;\n\t\t\t\t\tconst next = nextRunAtMs(schedule.cron, now);\n\t\t\t\t\tif (next !== void 0) this.deps.applySchedule(task.id, next, schedule.lastTriggeredAt);\n\t\t\t\t}\n\t\t\t\tthis.timer = setInterval(() => {`;
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Task-board startup patch expected one scheduler anchor, found ${occurrences}; `
      + "review the installed plugin before packaging.",
    );
  }
  fs.writeFileSync(bundlePath, source.replace(anchor, replacement), "utf8");
  return true;
}

/** Keep the bundled task-board entry visually aligned with Harness' 24px icons. */
export function patchTaskBoardIcon(runtimeDir) {
  const bundlePath = path.join(
    runtimeDir, "node_modules", "@linxin666", "dsh-client-ui-task-board", "lib", "client.js",
  );
  if (!fs.existsSync(bundlePath)) throw new Error(`Task-board client bundle missing: ${bundlePath}`);
  const source = fs.readFileSync(bundlePath, "utf8");
  if (source.includes(TASK_BOARD_ICON_PATCH_MARKER)) return false;
  const anchor = 'const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>`;';
  const replacement = `const ICON = \`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" data-gobuddy-icon="${TASK_BOARD_ICON_PATCH_MARKER}"><path d="M17.75 3C19.55 3 21 4.46 21 6.25v11.5c0 1.8-1.46 3.25-3.25 3.25H6.25A3.25 3.25 0 0 1 3 17.75V6.25C3 4.45 4.46 3 6.25 3zM4.5 17.75c0 .97.78 1.75 1.75 1.75h5.25v-10h-7zM13 16v3.5h4.75c.97 0 1.75-.78 1.75-1.75V16zm0-1.5h6.5V6.25c0-.97-.78-1.75-1.75-1.75H13zm-6.75-10c-.97 0-1.75.78-1.75 1.75V8h7V4.5z"/></svg>\`;`;
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Task-board icon patch expected one icon anchor, found ${occurrences}; review the installed plugin before packaging.`);
  }
  fs.writeFileSync(bundlePath, source.replace(anchor, replacement), "utf8");
  return true;
}

/** Make the task board participate in the shared exclusive-panel protocol. */
export function patchTaskBoardExclusivePanel(runtimeDir) {
  const bundlePath = path.join(
    runtimeDir, "node_modules", "@linxin666", "dsh-client-ui-task-board", "lib", "client.js",
  );
  if (!fs.existsSync(bundlePath)) throw new Error(`Task-board client bundle missing: ${bundlePath}`);
  const source = fs.readFileSync(bundlePath, "utf8");
  if (source.includes(TASK_BOARD_EXCLUSIVE_PANEL_PATCH_MARKER)) return false;
  const anchor = 'if (event.detail === "ssh" && controller.getSnapshot().boardOpen) controller.closeBoard();';
  const replacement = `// ${TASK_BOARD_EXCLUSIVE_PANEL_PATCH_MARKER}\n\t\t\t\tif (event.detail !== PANEL_NAME && controller.getSnapshot().boardOpen) controller.closeBoard();`;
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Task-board exclusive-panel patch expected one activation anchor, found ${occurrences}; review the installed plugin before packaging.`);
  }
  fs.writeFileSync(bundlePath, source.replace(anchor, replacement), "utf8");
  return true;
}

/** Platform-aware npm executable name (npm.cmd on Windows, npm elsewhere). */
export function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Install the preset plugins into the runtime's node_modules so DSH can
 * resolve them as profile bundles from the installation anchor. Uses npm
 * with --no-save so the runtime's own manifest stays untouched (the preset
 * list lives in gobuddy-harness-runtime.json instead).
 */
export function installPresetPlugins(runtimeDir) {
  // `file:` 前缀的预设（仓库内源码插件）相对仓库根目录（process.cwd()）解析，
  // 避免依赖 runtime 目录的相对位置。
  const repoRoot = process.cwd();
  const specs = Object.entries(PRESET_PLUGINS).map(([name, version]) => {
    if (typeof version === "string" && version.startsWith("file:")) {
      const target = path.resolve(repoRoot, version.slice("file:".length));
      // 文件型预设（.tgz 打包产物）：直接交给 npm install。
      if (target.endsWith(".tgz")) {
        if (!fs.existsSync(target)) {
          throw new Error(`Preset plugin ${name} file: target missing: ${target}`);
        }
        return target;
      }
      // 目录型预设（仓库内源码插件）：要求存在 package.json。
      if (!fs.existsSync(path.join(target, "package.json"))) {
        throw new Error(`Preset plugin ${name} file: target missing: ${target}`);
      }
      return target;
    }
    return `${name}@${version}`;
  });
  const result = spawnSync(npmCommand(), [
    "install",
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--legacy-peer-deps",
    ...specs,
  ], {
    cwd: runtimeDir,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(`Failed to install preset plugins into ${runtimeDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm install of preset plugins failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
  }
  // npm install 也会 materialize 运行时清单自身的依赖，其中包含
  // `gobuddy-electron: file:<repo>` — 那会在 node_modules 里创建一个指向整个
  // 仓库的 junction。去掉它，打包的运行时才不会带上项目本体（否则
  // electron-builder 会顺着 junction 把几 GB 的仓库内容复制进安装包）。
  const selfLink = path.join(runtimeDir, "node_modules", "gobuddy-electron");
  if (fs.existsSync(selfLink)) {
    fs.rmSync(selfLink, { recursive: true, force: true });
  }
  // npm install 对 `file:` 预设可能创建符号链接/junction；打包时 electron-builder
  // 会跟随链接，把插件源码目录乃至仓库内容带进安装包。把链接替换为真实副本。
  for (const name of Object.keys(PRESET_PLUGINS)) {
    const pkgDir = path.join(runtimeDir, "node_modules", name);
    let stat;
    try {
      stat = fs.lstatSync(pkgDir);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync(pkgDir);
      fs.rmSync(pkgDir, { recursive: true, force: true });
      fs.cpSync(real, pkgDir, { recursive: true });
    }
  }
  // Verify every preset plugin actually landed in the runtime's node_modules.
  for (const name of Object.keys(PRESET_PLUGINS)) {
    const pkgJson = path.join(runtimeDir, "node_modules", name, "package.json");
    if (!fs.existsSync(pkgJson)) {
      throw new Error(`Preset plugin ${name} missing after install: ${pkgJson}`);
    }
  }

  patchTaskBoardStartup(runtimeDir);
  patchTaskBoardIcon(runtimeDir);
  patchTaskBoardExclusivePanel(runtimeDir);
}

/**
 * Refresh directory-backed in-repo plugins even when the large bundled
 * Harness runtime is otherwise up to date. Without this step, editing a local
 * plugin after the first prepare run leaves an old copy in vendor/ and the
 * packaged application silently ships stale client code.
 */
export function syncDirectoryPresetPlugins(runtimeDir, repoRoot = process.cwd(), presets = PRESET_PLUGINS) {
  const synced = [];
  for (const [name, spec] of Object.entries(presets)) {
    if (typeof spec !== "string" || !spec.startsWith("file:") || spec.endsWith(".tgz")) continue;
    const source = path.resolve(repoRoot, spec.slice("file:".length));
    if (!fs.existsSync(path.join(source, "package.json"))) {
      throw new Error(`Preset plugin ${name} file: target missing: ${source}`);
    }
    const target = path.join(runtimeDir, "node_modules", name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    synced.push(name);
  }
  return synced;
}

/**
 * Record the preset plugin list next to the runtime manifest so the app can
 * seed new profiles with the matching bundle declarations at first run.
 */
export function writeRuntimeManifest(runtimeDir) {
  const manifestPath = path.join(runtimeDir, "gobuddy-harness-runtime.json");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }
  manifest.presetPlugins = Object.keys(PRESET_PLUGINS);
  manifest.presetPluginsUpdatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

/**
 * Build a Harness runtime from scratch in targetDir via `npm install`.
 * Used when no source runtime exists (fresh macOS/CI machines) or when the
 * caller explicitly wants a fresh install.
 * @param {string} targetDir - directory that will hold the runtime.
 * @returns {string} the targetDir.
 */
export function bootstrapHarnessRuntime(targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  // npm needs a package.json to reliably work with --prefix on an empty dir.
  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    JSON.stringify({ name: "gobuddy-harness-runtime", private: true }, null, 2),
    "utf8",
  );

  const result = spawnSync(npmCommand(), [
    "install",
    "--prefix",
    targetDir,
    "--save-exact",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--legacy-peer-deps",
    ...Object.values(defaultHarnessPackages),
  ], {
    cwd: targetDir,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(`Failed to install Harness runtime packages into ${targetDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm install of Harness runtime failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
  }

  const dshEntry = path.join(targetDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (!fs.existsSync(dshEntry)) {
    throw new Error(`Harness runtime install did not produce the expected entry: ${dshEntry}`);
  }

  installPresetPlugins(targetDir);
  writeRuntimeManifest(targetDir);

  console.log(`Bootstrapped bundled Harness runtime: ${targetDir}`);
  console.log(`Preset profile plugins: ${Object.keys(PRESET_PLUGINS).join(", ")}`);
  return targetDir;
}
