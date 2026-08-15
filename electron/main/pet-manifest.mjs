import fs from "node:fs";
import path from "node:path";

const requiredActionFields = ["mode", "priority", "durationMs", "loop", "fps", "frames", "hitbox", "message"];

export function loadPetManifest(publicPath = path.join(process.cwd(), "public")) {
  const manifestPath = path.join(publicPath, "pet", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return normalizePetManifest(manifest, publicPath);
}

export function normalizePetManifest(manifest, publicPath = path.join(process.cwd(), "public")) {
  const actions = {};
  const sourceActions = Array.isArray(manifest.actions) ? manifest.actions : [];

  for (const action of sourceActions) {
    const normalized = normalizeAction(action, publicPath);
    actions[normalized.mode] = normalized;
  }

  return {
    name: manifest.name ?? "GoBuddy Pet",
    version: manifest.version ?? 1,
    fallbackFrame: manifest.fallbackFrame ?? "assets/pet-cropped.png",
    actions,
  };
}

export function validatePetManifest(manifest) {
  const problems = [];
  const actions = Array.isArray(manifest.actions) ? manifest.actions : Object.values(manifest.actions ?? {});

  if (actions.length === 0) {
    problems.push("manifest must define at least one action");
  }

  for (const action of actions) {
    for (const field of requiredActionFields) {
      if (!(field in action)) {
        problems.push(`${action.mode ?? "unknown"} missing ${field}`);
      }
    }
    if (!Array.isArray(action.frames) || action.frames.length === 0) {
      problems.push(`${action.mode ?? "unknown"} must define frames`);
    }
    if (!action.hitbox || typeof action.hitbox.width !== "number" || typeof action.hitbox.height !== "number") {
      problems.push(`${action.mode ?? "unknown"} must define numeric hitbox`);
    }
  }

  return problems;
}

function normalizeAction(action, publicPath) {
  const frames = (action.frames ?? []).map((frame) => ({
    src: frame.src,
    exists: fs.existsSync(path.join(publicPath, frame.src)),
  }));

  return {
    ...action,
    frames,
    hasFrames: frames.some((frame) => frame.exists),
  };
}
