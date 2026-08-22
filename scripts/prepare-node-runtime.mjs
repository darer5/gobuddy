import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Node 22 official macOS binaries target macOS 11+, matching GoBuddy's
// documented macOS 12+ support. Node 24 official binaries require macOS 13.5+.
const NODE_VERSION = process.env.GOBUDDY_NODE_VERSION || "22.22.3";
const vendorRoot = path.join(process.cwd(), "vendor");
const targetDir = path.join(vendorRoot, "node");
const target = path.join(targetDir, process.platform === "win32" ? "node.exe" : "node");

assertInsideVendor(targetDir);

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-node-runtime-"));
try {
  const explicitSource = process.env.GOBUDDY_NODE_PATH;
  let source;
  if (explicitSource) {
    source = path.resolve(explicitSource);
    if (!fs.existsSync(source)) {
      throw new Error(`GOBUDDY_NODE_PATH does not exist: ${source}`);
    }
  } else {
    source = await downloadOfficialNode(temporaryDir);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, target);
  if (process.platform !== "win32") {
    fs.chmodSync(target, 0o755);
  }

  verifyBundledNode(target);
  console.log(`Prepared official Node.js v${NODE_VERSION} runtime: ${target}`);
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

async function downloadOfficialNode(temporaryRoot) {
  const arch = resolveTargetArch();
  const platform = process.platform;
  const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const shasums = await download(`${baseUrl}/SHASUMS256.txt`);

  let artifact;
  let sourceRelativePath;
  if (platform === "darwin") {
    artifact = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
    sourceRelativePath = path.join(`node-v${NODE_VERSION}-darwin-${arch}`, "bin", "node");
  } else if (platform === "win32") {
    artifact = `win-${arch}/node.exe`;
    sourceRelativePath = "node.exe";
  } else if (platform === "linux") {
    artifact = `node-v${NODE_VERSION}-linux-${arch}.tar.xz`;
    sourceRelativePath = path.join(`node-v${NODE_VERSION}-linux-${arch}`, "bin", "node");
  } else {
    throw new Error(`Unsupported platform for bundled Node runtime: ${platform}`);
  }

  const payload = await download(`${baseUrl}/${artifact}`);
  verifyChecksum(payload, artifact, shasums.toString("utf8"));

  if (platform === "win32") {
    const source = path.join(temporaryRoot, sourceRelativePath);
    fs.writeFileSync(source, payload);
    return source;
  }

  const archivePath = path.join(temporaryRoot, path.basename(artifact));
  fs.writeFileSync(archivePath, payload);
  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", temporaryRoot], { encoding: "utf8" });
  if (extracted.status !== 0) {
    throw new Error(`Failed to extract ${artifact}: ${extracted.stderr.trim()}`);
  }
  return path.join(temporaryRoot, sourceRelativePath);
}

async function download(url) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function verifyChecksum(payload, artifact, shasums) {
  const entry = shasums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.length >= 2 && parts[1] === artifact);
  if (!entry) {
    throw new Error(`No SHA-256 checksum published for ${artifact}`);
  }
  const actual = crypto.createHash("sha256").update(payload).digest("hex");
  if (actual !== entry[0]) {
    throw new Error(`SHA-256 mismatch for ${artifact}`);
  }
}

function verifyBundledNode(nodePath) {
  if (process.platform === "darwin") {
    const linkedLibraries = spawnSync("otool", ["-L", nodePath], { encoding: "utf8" });
    if (linkedLibraries.status !== 0) {
      throw new Error(`Unable to inspect bundled Node runtime: ${linkedLibraries.stderr.trim()}`);
    }
    if (/\/(?:usr\/local|opt\/homebrew)\//.test(linkedLibraries.stdout) || /@rpath\/libnode\./.test(linkedLibraries.stdout)) {
      throw new Error(
        "Bundled Node runtime depends on Homebrew libraries. "
        + "Use the official Node.js binary or unset GOBUDDY_NODE_PATH.",
      );
    }
  }

  const result = spawnSync(nodePath, ["--version"], { encoding: "utf8" });
  if (result.status !== 0 || result.stdout.trim() !== `v${NODE_VERSION}`) {
    throw new Error(
      `Bundled Node runtime self-check failed: expected v${NODE_VERSION}, `
      + `got ${result.stdout.trim() || result.stderr.trim() || `exit ${result.status}`}`,
    );
  }
}

function normalizeArch(arch) {
  if (arch === "x64" || arch === "arm64") {
    return arch;
  }
  throw new Error(`Unsupported Node runtime architecture: ${arch}`);
}

function resolveTargetArch() {
  if (process.env.GOBUDDY_NODE_ARCH) {
    return normalizeArch(process.env.GOBUDDY_NODE_ARCH);
  }
  if (process.platform === "darwin") {
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
      const configuredArch = packageJson.build?.mac?.target?.[0]?.arch;
      if (Array.isArray(configuredArch) && configuredArch.length === 1) {
        return normalizeArch(configuredArch[0]);
      }
    } catch {
      // Fall back to the build host architecture below.
    }
  }
  return normalizeArch(process.arch);
}

function assertInsideVendor(targetPath) {
  const resolvedVendor = path.resolve(vendorRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedVendor, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside vendor: ${resolvedTarget}`);
  }
}
