import fs from "node:fs";
import path from "node:path";

export default async function afterPack(context) {
  const resourcesDir = context.electronPlatformName === "darwin"
    ? path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    )
    : path.join(context.appOutDir, "resources");
  const vendorRoot = path.join(context.packager.projectDir, "vendor");

  copyResource({
    source: path.join(vendorRoot, "HarnessRuntimeManaged"),
    target: path.join(resourcesDir, "HarnessRuntimeManaged"),
    requiredFile: path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    resourcesDir,
  });

  copyResource({
    source: path.join(vendorRoot, "node"),
    target: path.join(resourcesDir, "node"),
    requiredFile: process.platform === "win32" ? "node.exe" : "node",
    resourcesDir,
  });
}

function copyResource({ source, target, requiredFile, resourcesDir }) {
  const sourceRequiredFile = path.join(source, requiredFile);
  if (!fs.existsSync(sourceRequiredFile)) {
    throw new Error(`Required bundled resource is missing: ${sourceRequiredFile}`);
  }

  assertInside(target, resourcesDir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function assertInside(targetPath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside resources: ${resolvedTarget}`);
  }
}
