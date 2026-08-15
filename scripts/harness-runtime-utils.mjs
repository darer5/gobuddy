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
  "dsh-better-sidebar": "0.12.1",
  "dshmarket": "1.3.0",
  "dsh-global-rules": "0.1.0",
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
  const specs = Object.entries(PRESET_PLUGINS).map(([name, version]) => `${name}@${version}`);
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
  // npm install also materializes the runtime manifest's own dependencies,
  // which include `gobuddy-electron: file:<repo>` — that creates a junction
  // pointing back at the whole repository. Drop it so the bundled runtime
  // never carries the project (electron-builder would follow the junction
  // and copy gigabytes of repo content into the installer).
  const selfLink = path.join(runtimeDir, "node_modules", "gobuddy-electron");
  if (fs.existsSync(selfLink)) {
    fs.rmSync(selfLink, { recursive: true, force: true });
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
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

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
