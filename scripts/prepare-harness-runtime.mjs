import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.GOBUDDY_HARNESS_RUNTIME
  || path.join(os.homedir(), "AppData", "Roaming", "GoBuddy", "HarnessRuntimeManaged");
const vendorRoot = path.join(process.cwd(), "vendor");
const target = path.join(vendorRoot, "HarnessRuntimeManaged");
const dshEntry = path.join(source, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");

if (!fs.existsSync(dshEntry)) {
  throw new Error(`Harness runtime is not ready: ${dshEntry}`);
}

assertInsideVendor(target);

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

console.log(`Prepared bundled Harness runtime: ${target}`);

function assertInsideVendor(targetPath) {
  const resolvedVendor = path.resolve(vendorRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedVendor, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside vendor: ${resolvedTarget}`);
  }
}
