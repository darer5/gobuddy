import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Plugins bundled into the Harness runtime and auto-mounted into every new
 * web profile. Key = npm package name, value = exact version (or npm range)
 * pinned at build time. Installing into the runtime's own node_modules lets
 * DSH resolve them as profile bundles without any profile-local install:
 * `resolveBundleDir` prefers the installation anchor, and the client half
 * resolves from the harness process's node_modules.
 */
const PRESET_PLUGINS = {
  "dsh-better-sidebar": "0.12.1",
  "dshmarket": "1.3.0",
  "dsh-global-rules": "0.1.0",
};

const source = process.env.GOBUDDY_HARNESS_RUNTIME
  || path.join(os.homedir(), "AppData", "Roaming", "GoBuddy", "HarnessRuntimeManaged");
const vendorRoot = path.join(process.cwd(), "vendor");
const target = path.join(vendorRoot, "HarnessRuntimeManaged");
const dshEntry = path.join(source, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");

if (!fs.existsSync(dshEntry)) {
  throw new Error(`Harness runtime is not ready: ${dshEntry}`);
}

assertInsideVendor(target);

if (isRuntimeUpToDate(target)) {
  console.log(`Bundled Harness runtime is up to date, skipping copy/install: ${target}`);
} else {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (item) => {
      if (/[/\\]node_modules[/\\]gobuddy-electron$/i.test(item)) {
        return false;
      }
      return !/[/\\](home|HarnessHome|dsh-web\.(out|err)\.log)$/i.test(item);
    },
  });

  installPresetPlugins(target);

  writeRuntimeManifest(target);

  console.log(`Prepared bundled Harness runtime: ${target}`);
}
console.log(`Preset profile plugins: ${Object.keys(PRESET_PLUGINS).join(", ")}`);

/**
 * Skip the copy/install when the bundled runtime already matches the source:
 * same dsh version, every preset plugin present in node_modules, and the
 * runtime manifest records the same preset list. Any mismatch — a newer
 * source runtime, a missing plugin, a stale manifest — falls through to a
 * full rebuild, so skipping can never degrade the packaged runtime.
 * @param {string} runtimeDir - the vendor runtime directory to inspect.
 * @returns {boolean} true when the bundled runtime is already up to date.
 */
function isRuntimeUpToDate(runtimeDir) {
  const dshPkg = path.join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
  if (!fs.existsSync(dshPkg)) {
    return false;
  }
  // Same dsh core version as the source runtime.
  try {
    const srcVersion = JSON.parse(fs.readFileSync(dshPkg, "utf8")).version;
    const srcPkg = path.join(source, "node_modules", "@deepseek-ai", "dsh", "package.json");
    if (!fs.existsSync(srcPkg) || JSON.parse(fs.readFileSync(srcPkg, "utf8")).version !== srcVersion) {
      return false;
    }
  } catch {
    return false;
  }
  // Every preset plugin must be physically present.
  for (const name of Object.keys(PRESET_PLUGINS)) {
    if (!fs.existsSync(path.join(runtimeDir, "node_modules", name, "package.json"))) {
      return false;
    }
  }
  // The runtime manifest must record the same preset list.
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, "gobuddy-harness-runtime.json"), "utf8"));
    const presets = manifest.presetPlugins;
    if (!Array.isArray(presets)) {
      return false;
    }
    for (const name of Object.keys(PRESET_PLUGINS)) {
      if (!presets.includes(name)) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Install the preset plugins into the runtime's node_modules so DSH can
 * resolve them as profile bundles from the installation anchor. Uses npm
 * with --no-save so the runtime's own manifest stays untouched (the preset
 * list lives in gobuddy-harness-runtime.json instead).
 */
function installPresetPlugins(runtimeDir) {
  const specs = Object.entries(PRESET_PLUGINS).map(([name, version]) => `${name}@${version}`);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, [
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
function writeRuntimeManifest(runtimeDir) {
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

function assertInsideVendor(targetPath) {
  const resolvedVendor = path.resolve(vendorRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedVendor, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside vendor: ${resolvedTarget}`);
  }
}
