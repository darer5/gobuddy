import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import squirrelStartup from "electron-squirrel-startup";
import {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  ipcMain,
  clipboard,
  dialog,
  desktopCapturer,
  globalShortcut,
  nativeImage,
  shell,
  screen,
  session,
} from "electron";
import { SettingsStore } from "./settings.mjs";
import { GoBuddyDatabase } from "./database.mjs";
import { registerGlobalHotkeys } from "./hotkeys.mjs";
import { ScreenshotController } from "./screenshot.mjs";
import { KnowledgeService } from "./knowledge-service.mjs";
import { HarnessRuntimeManager } from "./harness-runtime.mjs";
import { ChatAgentService } from "./chat-agent.mjs";
import { WebCanvasController } from "./web-canvas.mjs";

if (squirrelStartup) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.GOBUDDY_DEV_SERVER_URL;

let mainWindow;
let tray;
let settingsStore;
let database;
let screenshotController;
let knowledgeService;
let harnessRuntime;
let chatAgent;
let loadedHarnessUrl = null;
let webCanvasController;

app.setName("GoBuddy");

app.whenReady().then(async () => {
  appendMainLog("app.ready", { resourcesPath: process.resourcesPath, devServerUrl: Boolean(devServerUrl) });
  settingsStore = new SettingsStore(app.getPath("userData"));
  const settings = settingsStore.load();
  appendMainLog("settings.loaded", { harnessAutoStart: settings.harness?.autoStart, closeBehavior: settings.window?.closeBehavior });
  database = new GoBuddyDatabase(app.getPath("userData"));
  await database.initialize();
  appendMainLog("database.initialized");

  harnessRuntime = new HarnessRuntimeManager({
    userDataPath: app.getPath("userData"),
    sendEvent,
    settingsStore,
    runtimeDirName: "HarnessRuntimeManaged",
    bundledRuntimePath: path.join(process.resourcesPath, "HarnessRuntimeManaged"),
    localPresetPlugins: app.isPackaged ? {} : {
      "gobuddy-ui": path.join(app.getAppPath(), "plugins", "gobuddy-ui"),
      "dsh-web-canvas": path.join(app.getAppPath(), "plugins", "dsh-web-canvas"),
    },
  });
  appendMainLog("harnessRuntime.created", {
    bundledRuntimePath: path.join(process.resourcesPath, "HarnessRuntimeManaged"),
  });

  createMainWindow();
  appendMainLog("mainWindow.created");
  webCanvasController = new WebCanvasController({
    mainWindow,
    WebContentsView,
    session,
    shell,
    userDataPath: app.getPath("userData"),
    preloadPath: getPreloadPath("web-canvas.mjs"),
    sendEvent,
  });
  harnessRuntime.extraEnv = await webCanvasController.startBridge();
  appendMainLog("webCanvas.created", { bridgeReady: true });
  createTray();
  appendMainLog("tray.created");
  wireIpc();
  appendMainLog("ipc.wired");

  knowledgeService = new KnowledgeService({
    database,
    shellOpener: shell,
  });
  chatAgent = new ChatAgentService({
    database,
    knowledgeService,
    harnessRuntime,
    sendEvent,
  });

  screenshotController = new ScreenshotController({
    BrowserWindow,
    desktopCapturer,
    screen,
    clipboard,
    database,
    settingsStore,
    getPreloadPath,
    loadWindow,
  });

  registerHotkeys(settings.hotkeys);
  appendMainLog("hotkeys.registered");
  loadHarnessClientInMainWindow(settings);
}).catch((error) => {
  appendMainLog("app.ready.failed", { message: error.message, stack: error.stack });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  harnessRuntime?.stop({ notify: false });
  webCanvasController?.destroy();
});

app.on("window-all-closed", (event) => {
  if (!app.isQuitting) {
    event.preventDefault();
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: "GoBuddy",
    autoHideMenuBar: true,
    backgroundColor: "#f7f7f4",
    webPreferences: {
      preload: getPreloadPath("index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("close", async (event) => {
    appendMainLog("mainWindow.close", { isQuitting: Boolean(app.isQuitting) });
    if (app.isQuitting) {
      return;
    }

    event.preventDefault();
    const closeBehavior = settingsStore.load().window?.closeBehavior ?? "quit";
    appendMainLog("mainWindow.close.behavior", { closeBehavior });
    if (closeBehavior !== "ask") {
      handleCloseChoice(closeBehavior);
      return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "关闭 GoBuddy",
      message: "你想如何关闭主界面？",
      buttons: ["最小化到托盘", "退出 GoBuddy"],
      cancelId: 0,
      defaultId: 1,
    });
    if (choice.response === 0) {
      handleCloseChoice("minimize-to-tray");
    } else {
      handleCloseChoice("quit");
    }
  });

  mainWindow.on("closed", () => {
    appendMainLog("mainWindow.closed", { isQuitting: Boolean(app.isQuitting) });
    mainWindow = null;
    const closeBehavior = settingsStore?.load().window?.closeBehavior ?? "quit";
    if (!app.isQuitting && closeBehavior === "quit") {
      handleCloseChoice("quit");
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const harnessClientUrl = harnessRuntime?.getClientUrl?.();
    if (harnessClientUrl && url.startsWith(harnessClientUrl)) {
      return { action: "allow" };
    }
    shell.openExternal(url).catch((error) => database?.logEvent("window.open.external.failed", false, error.message));
    return { action: "deny" };
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    appendMainLog("window.preload.failed", { preloadPath, message: error.message, stack: error.stack });
  });

  loadHarnessSplash(mainWindow, "正在启动 DeepSeek Harness...").catch((error) => {
    appendMainLog("window.splash.failed", { message: error.message });
  });
}

async function loadHarnessClientInMainWindow(settings) {
  try {
    appendMainLog("window.loadHarness.requested", { autoStart: settings.harness?.autoStart });
    if (settings.harness?.autoStart === false) {
      await loadHarnessSplash(mainWindow, "Harness 自动启动已关闭，请在设置中启用。");
      return;
    }

    await loadHarnessSplash(mainWindow, "正在启动 DeepSeek Harness...");
    await harnessRuntime.start();
    const harnessClientUrl = harnessRuntime.getClientUrl();
    await waitForHarnessReady(harnessClientUrl, harnessRuntime);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // The port may have changed while waiting (auto-restart after a plugin
      // crash), so load whatever URL the runtime currently serves.
      const finalUrl = harnessRuntime.getClientUrl();
      loadedHarnessUrl = finalUrl;
      await mainWindow.loadURL(finalUrl);
      appendMainLog("window.loadHarness.loaded", { url: finalUrl });
    }
  } catch (error) {
    appendMainLog("window.loadHarness.failed", { message: error.message, stack: error.stack });
    database?.logEvent("window.load.failed", false, error.message);
    harnessRuntime?.setStatus?.("error", `DeepSeek Harness 客户端加载失败：${error.message}`);
    await loadHarnessError(mainWindow, error).catch((pageError) => {
      appendMainLog("window.errorPage.failed", { message: pageError.message });
    });
  }
}

function createTray() {
  // macOS cannot render .ico files; use the PNG tray icon there.
  const iconFileName = process.platform === "darwin" ? "tray-icon.png" : "favicon.ico";
  const iconPath = path.join(app.getAppPath(), "public", iconFileName);
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("GoBuddy");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开主界面", click: () => showMainWindow() },
      { type: "separator" },
      { label: "退出 GoBuddy", click: () => handleCloseChoice("quit") },
    ]),
  );
}

function wireIpc() {
  ipcMain.handle("screenshot:startRegionCapture", () => screenshotController.startRegionCapture());
  ipcMain.handle("screenshot:completeRegionCapture", (_, rect) => screenshotController.completeRegionCapture(rect));
  ipcMain.handle("screenshot:cancelRegionCapture", () => screenshotController.cancelRegionCapture());
  ipcMain.handle("settings:get", () => settingsStore.load());
  ipcMain.handle("settings:update", (_, partialSettings) => {
    const previousSettings = settingsStore.load();
    const settings = settingsStore.update(partialSettings);
    if (
      partialSettings?.hotkeys
      && JSON.stringify(partialSettings.hotkeys) !== JSON.stringify(previousSettings.hotkeys)
    ) {
      try {
        applyHotkeyRegistration(settings.hotkeys, previousSettings.hotkeys);
      } catch (error) {
        // Keep the persisted settings and the registered shortcuts consistent:
        // roll both back before surfacing the error.
        settingsStore.save(previousSettings);
        throw error;
      }
    }
    sendEvent("settings:changed", settings);
    return settings;
  });
  ipcMain.handle("hotkeys:register", (_, hotkeys) => {
    const previousSettings = settingsStore.load();
    const results = applyHotkeyRegistration(hotkeys, previousSettings.hotkeys);
    const settings = settingsStore.update({ hotkeys });
    sendEvent("settings:changed", settings);
    return { settings, results };
  });
  ipcMain.handle("window:closeChoice", (_, choice) => handleCloseChoice(choice));
  ipcMain.handle("knowledge:search", (_, query) => knowledgeService.search(query));
  ipcMain.handle("knowledge:listRecent", (_, query) => knowledgeService.listRecent(query));
  ipcMain.handle("knowledge:update", (_, id, patch) => knowledgeService.update(id, patch));
  ipcMain.handle("knowledge:confirmAction", (_, actionId, approved) => knowledgeService.confirmAction(actionId, approved));
  ipcMain.handle("knowledge:open", (_, id) => knowledgeService.open(id));
  ipcMain.handle("harness:status", () => harnessRuntime.getStatus());
  ipcMain.handle("harness:install", () => harnessRuntime.install());
  ipcMain.handle("harness:start", () => harnessRuntime.start());
  ipcMain.handle("harness:sendMessage", (_, payload) => chatAgent.sendMessage(payload));
  ipcMain.handle("harness:stop", () => chatAgent.stop());
  ipcMain.handle("harness:listSessions", () => chatAgent.listSessions());
  ipcMain.handle("harness:listMessages", (_, sessionId) => chatAgent.listMessages(sessionId));
  ipcMain.handle("harness:defaultWorkspace", () => {
    const workspacePath = path.join(app.getPath("userData"), "Conversations");
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
  });
  ipcMain.handle("web-canvas:open", (_, payload) => webCanvasController.open(payload));
  ipcMain.handle("web-canvas:close", () => webCanvasController.close());
  ipcMain.handle("web-canvas:setSuspended", (_, value) => webCanvasController.setSuspended(value));
  ipcMain.handle("web-canvas:setBounds", (_, bounds) => webCanvasController.setBounds(bounds));
  ipcMain.handle("web-canvas:navigate", (_, payload) => webCanvasController.navigate(payload));
  ipcMain.handle("web-canvas:back", () => webCanvasController.goBack());
  ipcMain.handle("web-canvas:forward", () => webCanvasController.goForward());
  ipcMain.handle("web-canvas:reload", () => webCanvasController.reload());
  ipcMain.handle("web-canvas:setReadingMode", (_, value) => webCanvasController.setReadingMode(value));
  ipcMain.handle("web-canvas:setTool", (_, tool) => webCanvasController.setTool(tool));
  ipcMain.handle("web-canvas:undo", () => webCanvasController.undo());
  ipcMain.handle("web-canvas:deleteAnnotation", (_, id) => webCanvasController.deleteAnnotation(id));
  ipcMain.handle("web-canvas:focusAnnotation", (_, id) => webCanvasController.focusAnnotation(id));
  ipcMain.handle("web-canvas:getState", () => webCanvasController.getState());
  ipcMain.handle("web-canvas:capture", () => webCanvasController.captureViewport());
  ipcMain.handle("web-canvas:captureRegion", (event, geometry) => {
    if (event.sender !== webCanvasController?.view?.webContents) throw new Error("无效的 PageLens 截图来源。");
    return webCanvasController.captureRegion(geometry);
  });
  ipcMain.handle("web-canvas:readAnnotationCapture", (_, id) => webCanvasController.readAnnotationCapture(id));
  ipcMain.on("web-canvas:annotation-create", (event, annotation) => {
    if (event.sender === webCanvasController?.view?.webContents) webCanvasController.saveAnnotation(annotation);
  });
  ipcMain.on("web-canvas:annotation-delete", (event, id) => {
    if (event.sender === webCanvasController?.view?.webContents) webCanvasController.deleteAnnotation(id);
  });
  ipcMain.on("web-canvas:selection", (event, text) => {
    if (event.sender !== webCanvasController?.view?.webContents || !webCanvasController.currentContext) return;
    webCanvasController.currentContext.selection = text ? { text: String(text).slice(0, 4000) } : undefined;
    webCanvasController.emitState();
  });
  ipcMain.on("web-canvas:annotation-status", (event, payload) => {
    if (event.sender === webCanvasController?.view?.webContents) webCanvasController.setAnnotationStatus(payload ?? {});
  });
}

function applyHotkeyRegistration(hotkeys, previousHotkeys) {
  const results = registerHotkeys(hotkeys);
  const failures = Object.entries(results).filter(([, result]) => !result.registered);
  if (failures.length > 0) {
    registerHotkeys(previousHotkeys);
    const message = failures
      .map(([name, result]) => `${name}: ${result.error ?? result.accelerator}`)
      .join("；");
    throw new Error(`快捷键注册失败：${message}`);
  }
  return results;
}

function registerHotkeys(hotkeys) {
  try {
    return registerGlobalHotkeys(
      globalShortcut,
      hotkeys,
      {
        screenshot: () => screenshotController?.startRegionCapture(),
      },
      (type, success, message) => database.logEvent(type, success, message),
    );
  } catch (error) {
    database?.logEvent("hotkey.register.invalid", false, error.message);
    return {
      screenshot: { accelerator: hotkeys?.screenshot ?? "", registered: false, error: error.message },
    };
  }
}

function handleCloseChoice(choice) {
  appendMainLog("window.closeChoice", { choice });
  if (choice === "show-main") {
    showMainWindow();
    return { ok: true };
  }

  if (choice === "minimize-to-tray") {
    mainWindow?.hide();
    return { ok: true };
  }

  app.isQuitting = true;
  harnessRuntime?.stop({ notify: false });
  globalShortcut.unregisterAll();
  app.exit(0);
  return { ok: true };
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    loadHarnessClientInMainWindow(settingsStore.load());
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function sendEvent(event, payload) {
  if (event === "chat:status" && payload?.state === "running") {
    handleHarnessRunningStatus(payload);
  }
  sendToWindow(mainWindow, event, payload);
}

/**
 * When the harness ends up serving a different URL than the one loaded in the
 * main window (a plugin restart adopted on the same port keeps the URL; an
 * auto-restart after a plugin crash may move to a fresh port), reload the
 * window so the client never stays pointed at a dead harness.
 */
function handleHarnessRunningStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed() || !loadedHarnessUrl) {
    return;
  }
  const url = harnessRuntime?.getClientUrl?.();
  if (!url || url === loadedHarnessUrl) {
    return;
  }
  appendMainLog("window.loadHarness.relocated", { from: loadedHarnessUrl, to: url });
  loadedHarnessUrl = url;
  mainWindow.loadURL(url).catch((error) => {
    appendMainLog("window.loadHarness.relocated.failed", { message: error.message });
  });
}

function sendToWindow(window, event, payload) {
  try {
    if (!window || window.isDestroyed()) {
      return;
    }

    const { webContents } = window;
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    webContents.send(event, payload);
  } catch (error) {
    if (!app.isQuitting) {
      console.warn(`Failed to send ${event} to window:`, error);
    }
  }
}

function appendMainLog(event, payload = {}) {
  try {
    const userDataPath = app.getPath("userData");
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.appendFileSync(
      path.join(userDataPath, "gobuddy-main.log"),
      `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`,
      "utf8",
    );
  } catch {
    // Logging should never interfere with app startup or shutdown.
  }
}

function getPreloadPath(fileName) {
  return path.join(__dirname, "..", "preload", fileName);
}

async function loadWindow(window, hash) {
  if (devServerUrl) {
    await window.loadURL(`${devServerUrl}/${hash}`);
    return;
  }

  await window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"), { hash: hash.replace("#", "") });
}

/**
 * Startup detection, deliberately isolated from plugin internals: it only
 * asks whether the harness web client responds on the runtime's current URL.
 * A plugin's one-click restart kills the managed process and boots a detached
 * replacement, so a dead managed process is NOT treated as failure while the
 * runtime is still recovering — only a runtime-level error (recovery and
 * auto-restart budget exhausted) aborts early.
 */
async function waitForHarnessReady(harnessClientUrl, runtime, { timeoutMs = 45000, intervalMs = 500 } = {}) {
  const startedAt = Date.now();
  let lastError = new Error("Harness is not ready");
  // Probe each URL with a bounded request timeout so an unresponsive listener
  // on the port cannot stall the whole startup window.
  const probeTimeoutMs = 1500;

  while (Date.now() - startedAt < timeoutMs) {
    if (runtime) {
      const status = runtime.getStatus();
      if (status.state === "error") {
        throw new Error(status.message || "Harness 启动失败");
      }
    }
    const url = runtime?.getClientUrl?.() ?? harnessClientUrl;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) {
        return url;
      }
      lastError = new Error(`Harness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError;
}

async function loadHarnessSplash(window, message) {
  if (!window || window.isDestroyed()) {
    return;
  }

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHarnessShellPage({
    title: "GoBuddy",
    heading: "DeepSeek Harness",
    message,
    tone: "loading",
  }))}`);
}

async function loadHarnessError(window, error) {
  if (!window || window.isDestroyed()) {
    return;
  }

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHarnessShellPage({
    title: "GoBuddy 启动失败",
    heading: "Harness 启动失败",
    message: error.message,
    tone: "error",
  }))}`);
}

function renderHarnessShellPage({ title, heading, message, tone }) {
  const isError = tone === "error";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #0f1115;
      background: #f5f6f7;
    }
    body {
      display: grid;
      place-items: center;
      min-height: 100vh;
      margin: 0;
    }
    main {
      display: grid;
      gap: 14px;
      width: min(460px, calc(100vw - 48px));
      padding: 28px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(15, 17, 21, 0.08);
    }
    .mark {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: ${isError ? "#ec1313" : "#4176e6"};
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
    }
    p {
      margin: 0;
      color: #61666b;
      line-height: 1.6;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(65, 118, 230, 0.2);
      border-top-color: #4176e6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-color-scheme: dark) {
      :root { color: #f9fafb; background: #1b1b1c; }
      main { border-color: rgba(255,255,255,0.1); background: #232324; box-shadow: none; }
      p { color: #cfd3d6; }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark"></div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    ${isError ? "" : "<div class=\"spinner\" aria-label=\"loading\"></div>"}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
