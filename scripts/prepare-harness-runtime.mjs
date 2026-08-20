import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PRESET_PLUGINS,
  bootstrapHarnessRuntime,
  installPresetPlugins,
  writeRuntimeManifest,
} from "./harness-runtime-utils.mjs";
import { defaultHarnessPackages } from "../electron/main/harness-runtime.mjs";

/**
 * Prepare the bundled DeepSeek Harness runtime at vendor/HarnessRuntimeManaged
 * for packaging.
 *
 * Source precedence:
 *   1. GOBUDDY_HARNESS_RUNTIME env var (explicit path to a prepared runtime).
 *   2. The platform's GoBuddy user-data location:
 *        Windows: %USERPROFILE%\AppData\Roaming\GoBuddy\HarnessRuntimeManaged
 *        macOS/Linux: ~/Library/Application Support/GoBuddy/HarnessRuntimeManaged
 *   3. If neither exists, the runtime is bootstrapped from scratch via npm
 *      (see bootstrapHarnessRuntime) — this is how fresh macOS/CI machines
 *      build without a pre-existing GoBuddy install.
 */
const defaultSource = process.platform === "win32"
  ? path.join(os.homedir(), "AppData", "Roaming", "GoBuddy", "HarnessRuntimeManaged")
  : path.join(os.homedir(), "Library", "Application Support", "GoBuddy", "HarnessRuntimeManaged");
const source = process.env.GOBUDDY_HARNESS_RUNTIME || defaultSource;
const vendorRoot = path.join(process.cwd(), "vendor");
const target = path.join(vendorRoot, "HarnessRuntimeManaged");
const dshEntry = path.join(source, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const expectedDshVersion = defaultHarnessPackages.dsh.slice(defaultHarnessPackages.dsh.lastIndexOf("@") + 1);

assertInsideVendor(target);

if (isRuntimeUpToDate(target)) {
  console.log(`Bundled Harness runtime is up to date, skipping copy/install: ${target}`);
} else if (fs.existsSync(dshEntry) && readDshVersion(source) === expectedDshVersion) {
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
} else {
  console.log(
    `No ${expectedDshVersion} source Harness runtime found at:\n  ${source}\n`
    + `Bootstrapping the bundled runtime from scratch via npm instead.\n`
    + `(Set GOBUDDY_HARNESS_RUNTIME to a prepared runtime to copy from.)`,
  );
  bootstrapHarnessRuntime(target);
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
  // The bundled runtime must match the version pinned by the application.
  // Comparing only with a pre-existing local runtime can silently preserve an
  // old Harness release after the application pin is upgraded.
  if (readDshVersion(runtimeDir) !== expectedDshVersion) {
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

function readDshVersion(runtimeDir) {
  try {
    const pkg = path.join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
  } catch {
    return null;
  }
}

function assertInsideVendor(targetPath) {
  const resolvedVendor = path.resolve(vendorRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedVendor, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside vendor: ${resolvedTarget}`);
  }
}
