import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class ClipboardMonitor {
  constructor({ clipboard, nativeImage, database, settingsStore, sendEvent, setPetMode }) {
    this.clipboard = clipboard;
    this.nativeImage = nativeImage;
    this.database = database;
    this.settingsStore = settingsStore;
    this.sendEvent = sendEvent;
    this.setPetMode = setPetMode;
    this.lastHash = "";
    this.timer = null;
    this.skipNextCapture = true;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.captureCurrent(), 900);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  captureCurrent() {
    const settings = this.settingsStore.load();
    if (!settings.clipboard.enabled) {
      return null;
    }

    const item = this.readClipboardItem(settings);
    if (!item) {
      this.skipNextCapture = false;
      return null;
    }

    if (item.contentHash === this.lastHash) {
      return null;
    }

    this.lastHash = item.contentHash;
    if (this.skipNextCapture) {
      this.skipNextCapture = false;
      return null;
    }

    this.database.addClipboardItem(item, settings.clipboard.historyLimit);
    this.database.logEvent("clipboard.recorded", true, `${item.type} clipboard item recorded`);
    this.sendEvent("clipboard:changed", item);
    this.setPetMode(modeForClipboardItem(item), messageForClipboardItem(item), { force: true });
    return item;
  }

  readClipboardItem(settings) {
    const image = this.clipboard.readImage();
    if (!image.isEmpty()) {
      const png = image.toPNG();
      const contentHash = hashBuffer(png);
      const fileName = `clipboard-${Date.now()}.png`;
      const filePath = path.join(this.settingsStore.clipboardImagesPath, fileName);
      fs.writeFileSync(filePath, png);
      return {
        id: crypto.randomUUID(),
        type: "image",
        title: fileName,
        content: filePath,
        filePath,
        contentHash,
        createdAt: new Date().toISOString(),
        favorite: false,
        sensitive: false,
        metadata: { bytes: png.length },
      };
    }

    const text = this.clipboard.readText().trim();
    if (!text) {
      return null;
    }

    const type = isLikelyUrl(text) ? "link" : "text";
    return {
      id: crypto.randomUUID(),
      type,
      title: preview(text, 80),
      content: text,
      contentHash: hashText(text),
      createdAt: new Date().toISOString(),
      favorite: false,
      sensitive: isSensitive(text),
      metadata: { length: text.length },
    };
  }

  restore(id) {
    const item = this.database.findClipboard(id);
    if (!item) {
      return { ok: false, message: "未找到剪贴板条目。" };
    }

    if (item.type === "image" && item.filePath && fs.existsSync(item.filePath)) {
      this.clipboard.writeImage(this.nativeImage.createFromPath(item.filePath));
    } else {
      this.clipboard.writeText(item.content);
    }

    this.setPetMode("clipboard-text", "已恢复到系统剪贴板。", { force: true });
    return { ok: true, item };
  }
}

export function modeForClipboardItem(item) {
  if (item.type === "image") return "clipboard-image";
  if (item.type === "link") return "clipboard-link";
  return "clipboard-text";
}

function messageForClipboardItem(item) {
  if (item.type === "image") return "图片已收进剪贴板历史。";
  if (item.type === "link") return "链接已收进剪贴板历史。";
  return "剪贴板有新内容。";
}

export function classifyClipboardText(text) {
  return isLikelyUrl(text) ? "link" : "text";
}

function isLikelyUrl(text) {
  return /^https?:\/\/\S+$/i.test(text) || /^www\.\S+$/i.test(text);
}

function isSensitive(text) {
  return /(password|token|secret|api[_-]?key|bearer\s+[a-z0-9._-]+)/i.test(text);
}

function preview(text, length) {
  return text.length <= length ? text : `${text.slice(0, length)}...`;
}

function hashText(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
