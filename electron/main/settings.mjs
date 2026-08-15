import fs from "node:fs";
import path from "node:path";

export const defaultSettings = {
  hotkeys: {
    screenshot: "Ctrl+Shift+S",
    clipboardHistory: "Ctrl+Shift+V",
  },
  screenshot: {
    saveDirectory: "",
  },
  clipboard: {
    enabled: true,
    historyLimit: 100,
  },
  ai: {
    deepseekApiKey: "",
    deepseekBaseUrl: "https://api.deepseek.com",
    provider: "deepseek-official",
    model: "deepseek-chat",
  },
  harness: {
    autoStart: true,
  },
  appearance: {
    theme: "system",
    sidebarCollapsed: false,
    detailsOpen: false,
  },
  window: {
    closeBehavior: "quit",
  },
  pet: {
    enabled: true,
    x: 980,
    y: 520,
    actionsEnabled: true,
  },
};

export class SettingsStore {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.settingsPath = path.join(userDataPath, "settings.json");
    this.screenshotsPath = path.join(userDataPath, "Screenshots");
    this.clipboardImagesPath = path.join(userDataPath, "ClipboardImages");
  }

  ensureDirectories() {
    fs.mkdirSync(this.userDataPath, { recursive: true });
    fs.mkdirSync(this.screenshotsPath, { recursive: true });
    fs.mkdirSync(this.clipboardImagesPath, { recursive: true });
  }

  load() {
    this.ensureDirectories();
    if (!fs.existsSync(this.settingsPath)) {
      const defaults = this.withResolvedDefaults(defaultSettings);
      this.save(defaults);
      return defaults;
    }

    try {
      const raw = fs.readFileSync(this.settingsPath, "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw);
      return this.withResolvedDefaults(mergeSettings(defaultSettings, parsed));
    } catch {
      return this.withResolvedDefaults(defaultSettings);
    }
  }

  save(settings) {
    this.ensureDirectories();
    const resolved = this.withResolvedDefaults(settings);
    fs.writeFileSync(this.settingsPath, JSON.stringify(resolved, null, 2), "utf8");
    return resolved;
  }

  update(partialSettings) {
    const next = mergeSettings(this.load(), partialSettings);
    return this.save(next);
  }

  withResolvedDefaults(settings) {
    return mergeSettings(settings, {
      screenshot: {
        saveDirectory: settings.screenshot?.saveDirectory || this.screenshotsPath,
      },
    });
  }
}

export function mergeSettings(base, patch) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeSettings(output[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
