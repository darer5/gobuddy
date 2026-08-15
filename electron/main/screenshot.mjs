import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class ScreenshotController {
  constructor({ BrowserWindow, desktopCapturer, screen, clipboard, database, settingsStore, getPreloadPath, loadWindow, setPetMode }) {
    this.BrowserWindow = BrowserWindow;
    this.desktopCapturer = desktopCapturer;
    this.screen = screen;
    this.clipboard = clipboard;
    this.database = database;
    this.settingsStore = settingsStore;
    this.getPreloadPath = getPreloadPath;
    this.loadWindow = loadWindow;
    this.setPetMode = setPetMode;
    this.captureWindow = null;
  }

  async startRegionCapture() {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.focus();
      return { ok: true, alreadyOpen: true };
    }

    const bounds = getVirtualDisplayBounds(this.screen.getAllDisplays());
    this.captureWindow = new this.BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: this.getPreloadPath("capture.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await this.loadWindow(this.captureWindow, "#capture");
    this.setPetMode("screenshot-start", "截图选择框已打开。", { force: true });
    return { ok: true };
  }

  async completeRegionCapture(rect) {
    const windowBounds = this.captureWindow?.getBounds() ?? getVirtualDisplayBounds(this.screen.getAllDisplays());
    const globalRect = {
      x: windowBounds.x + Math.round(rect.x),
      y: windowBounds.y + Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
    const displays = this.screen.getAllDisplays();
    const display = findDisplayForRect(displays, globalRect) ?? this.screen.getPrimaryDisplay();
    const normalized = {
      x: Math.max(0, globalRect.x - display.bounds.x),
      y: Math.max(0, globalRect.y - display.bounds.y),
      width: Math.min(globalRect.width, display.bounds.width),
      height: Math.min(globalRect.height, display.bounds.height),
    };
    const sources = await this.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: display.bounds.width,
        height: display.bounds.height,
      },
    });
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
    const image = source.thumbnail.crop(normalized);
    const filePath = path.join(this.settingsStore.load().screenshot.saveDirectory, `screenshot-${Date.now()}.png`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, image.toPNG());
    this.clipboard.writeImage(image);
    const item = {
      id: crypto.randomUUID(),
      filePath,
      createdAt: new Date().toISOString(),
      width: normalized.width,
      height: normalized.height,
      copiedToClipboard: true,
      message: "截图已保存并复制到剪贴板。",
    };
    this.database.addScreenshot(item);
    this.database.logEvent("screenshot.saved", true, item.message);
    this.setPetMode("screenshot-success", item.message, { force: true });
    this.closeCaptureWindow();
    return { ok: true, item };
  }

  cancelRegionCapture() {
    this.database.logEvent("screenshot.cancelled", true, "截图已取消。");
    this.setPetMode("screenshot-cancel", "已取消截图。", { force: true });
    this.closeCaptureWindow();
    return { ok: true };
  }

  closeCaptureWindow() {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.close();
    }
    this.captureWindow = null;
  }
}

export function getVirtualDisplayBounds(displays) {
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function findDisplayForRect(displays, rect) {
  const center = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };

  return displays.find((display) => (
    center.x >= display.bounds.x
    && center.x <= display.bounds.x + display.bounds.width
    && center.y >= display.bounds.y
    && center.y <= display.bounds.y + display.bounds.height
  ));
}
