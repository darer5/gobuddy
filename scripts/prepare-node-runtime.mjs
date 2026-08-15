import fs from "node:fs";
import path from "node:path";

const source = process.env.GOBUDDY_NODE_PATH || process.env.npm_node_execpath || process.execPath;
const vendorRoot = path.join(process.cwd(), "vendor");
const targetDir = path.join(vendorRoot, "node");
const target = path.join(targetDir, process.platform === "win32" ? "node.exe" : "node");

assertInsideVendor(targetDir);

if (!source || !fs.existsSync(source)) {
  throw new Error(`Node runtime source does not exist: ${source}`);
}

const sourceName = path.basename(source).toLowerCase();
if (process.platform === "win32" && sourceName !== "node.exe") {
  throw new Error(`Expected a Windows node.exe runtime, got: ${source}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);

console.log(`Prepared bundled Node runtime: ${target}`);

function assertInsideVendor(targetPath) {
  const resolvedVendor = path.resolve(vendorRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedVendor, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside vendor: ${resolvedTarget}`);
  }
}
