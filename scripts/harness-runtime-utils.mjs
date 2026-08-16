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
  "dsh-better-sidebar": "0.12.2",
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
  "aegis": "0.1.0",
  // 仓库内源码插件：用 file: 相对仓库根目录的路径（见 installPresetPlugins）。
  "dsh-weread-sidebar": "file:plugins/dsh-weread-sidebar",
  "graph-memory": "file:plugins/graph-memory-1.6.0-beta.1.tgz",
};

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
