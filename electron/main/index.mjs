import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import squirrelStartup from "electron-squirrel-startup";
import {
  app,
  BrowserWindow,
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
} from "electron";
import { SettingsStore } from "./settings.mjs";
import { GoBuddyDatabase } from "./database.mjs";
import { registerGlobalHotkeys } from "./hotkeys.mjs";
import { ClipboardMonitor } from "./clipboard.mjs";
import { ScreenshotController } from "./screenshot.mjs";
import { PetStateMachine } from "./pet-state.mjs";
import { loadPetManifest } from "./pet-manifest.mjs";
import { clampPetBounds, defaultPetWindowSize, movePetBounds } from "./pet-window-bounds.mjs";
import { KnowledgeService } from "./knowledge-service.mjs";
import { installKnowledgeSurface } from "./knowledge-surface.mjs";
import { HarnessRuntimeManager } from "./harness-runtime.mjs";
import { ChatAgentService } from "./chat-agent.mjs";

if (squirrelStartup) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.GOBUDDY_DEV_SERVER_URL;
const harnessClientUrl = "http://127.0.0.1:3080/";

let mainWindow;
let petWindow;
let tray;
let settingsStore;
let database;
let clipboardMonitor;
let screenshotController;
let knowledgeService;
let harnessRuntime;
let chatAgent;
const petState = new PetStateMachine();

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
  });
  appendMainLog("harnessRuntime.created", {
    bundledRuntimePath: path.join(process.resourcesPath, "HarnessRuntimeManaged"),
  });

  createMainWindow();
  appendMainLog("mainWindow.created");
  createTray();
  appendMainLog("tray.created");
  wireIpc();
  appendMainLog("ipc.wired");

  clipboardMonitor = new ClipboardMonitor({
    clipboard,
    nativeImage,
    database,
    settingsStore,
    sendEvent,
    setPetMode,
  });
  clipboardMonitor.start();
  appendMainLog("clipboardMonitor.started");

  knowledgeService = new KnowledgeService({
    database,
    clipboardMonitor,
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
    setPetMode,
  });

  registerHotkeys(settings.hotkeys);
  appendMainLog("hotkeys.registered");
  loadHarnessClientInMainWindow(settings);
  setInterval(() => setPetState(petState.tick()), 1200);
}).catch((error) => {
  appendMainLog("app.ready.failed", { message: error.message, stack: error.stack });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  harnessRuntime?.stop({ notify: false });
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
      buttons: ["只保留宠物浮窗", "最小化到托盘", "退出 GoBuddy"],
      cancelId: 1,
      defaultId: 2,
    });
    if (choice.response === 0) {
      handleCloseChoice("pet-only");
    } else if (choice.response === 1) {
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
    if (url.startsWith(harnessClientUrl)) {
      return { action: "allow" };
    }
    shell.openExternal(url).catch((error) => database?.logEvent("window.open.external.failed", false, error.message));
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow?.webContents.getURL() ?? "";
    if (currentUrl.startsWith(harnessClientUrl)) {
      installKnowledgeSurface(mainWindow)
        .then((surfaceState) => appendMainLog("knowledgeSurface.injected", surfaceState))
        .catch((error) => {
          appendMainLog("knowledgeSurface.inject.failed", { message: error.message, stack: error.stack });
        });
    }
  });

  loadHarnessSplash(mainWindow, "正在启动 DeepSeek Harness...");
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
    await waitForHarnessReady();
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(harnessClientUrl);
      const surfaceState = await installKnowledgeSurface(mainWindow);
      appendMainLog("knowledgeSurface.injected", surfaceState);
      appendMainLog("window.loadHarness.loaded", { url: harnessClientUrl });
    }
  } catch (error) {
    appendMainLog("window.loadHarness.failed", { message: error.message, stack: error.stack });
    database?.logEvent("window.load.failed", false, error.message);
    harnessRuntime?.setStatus?.("error", `DeepSeek Harness 客户端加载失败：${error.message}`);
    await loadHarnessError(mainWindow, error);
  }
}

function createPetWindow(settings) {
  const bounds = clampPetBounds(
    { x: settings.pet.x, y: settings.pet.y, ...defaultPetWindowSize },
    screen.getAllDisplays(),
  );
  settingsStore.update({ pet: { x: bounds.x, y: bounds.y } });

  petWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: getPreloadPath("pet.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setPetPointerMode("interactive");
  petWindow.on("moved", () => {
    const [x, y] = petWindow.getPosition();
    settingsStore.update({ pet: { x, y } });
  });
  loadWindow(petWindow, "#pet")
    .then(() => setPetState(petState.snapshot()))
    .catch((error) => {
      database?.logEvent("pet.load.failed", false, error.message);
    });
}

function createTray() {
  const iconPath = path.join(process.cwd(), "public", "favicon.ico");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("GoBuddy");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开主界面", click: () => showMainWindow() },
      { label: "显示宠物浮窗", click: () => showPetWindow() },
      { type: "separator" },
      { label: "退出 GoBuddy", click: () => handleCloseChoice("quit") },
    ]),
  );
}

function wireIpc() {
  ipcMain.handle("clipboard:list", (_, query) => database.listClipboard(query));
  ipcMain.handle("clipboard:restore", (_, id) => clipboardMonitor.restore(id));
  ipcMain.handle("clipboard:delete", (_, id) => {
    database.deleteClipboard(id);
    sendEvent("clipboard:changed", { deletedId: id });
    return { ok: true };
  });
  ipcMain.handle("clipboard:favorite", (_, id, favorite) => {
    database.favoriteClipboard(id, favorite);
    sendEvent("clipboard:changed", { favoriteId: id, favorite });
    return { ok: true };
  });
  ipcMain.handle("screenshot:startRegionCapture", () => screenshotController.startRegionCapture());
  ipcMain.handle("screenshot:completeRegionCapture", (_, rect) => screenshotController.completeRegionCapture(rect));
  ipcMain.handle("screenshot:cancelRegionCapture", () => screenshotController.cancelRegionCapture());
  ipcMain.handle("settings:get", () => settingsStore.load());
  ipcMain.handle("settings:update", (_, partialSettings) => {
    const settings = settingsStore.update(partialSettings);
    sendEvent("settings:changed", settings);
    return settings;
  });
  ipcMain.handle("hotkeys:register", (_, hotkeys) => {
    const previousSettings = settingsStore.load();
    const results = registerHotkeys(hotkeys);
    const failures = Object.entries(results).filter(([, result]) => !result.registered);
    if (failures.length > 0) {
      registerHotkeys(previousSettings.hotkeys);
      const message = failures
        .map(([name, result]) => `${name}: ${result.error ?? result.accelerator}`)
        .join("；");
      throw new Error(`快捷键注册失败：${message}`);
    }

    const settings = settingsStore.update({ hotkeys });
    sendEvent("settings:changed", settings);
    return { settings, results };
  });
  ipcMain.handle("window:closeChoice", (_, choice) => handleCloseChoice(choice));
  ipcMain.handle("pet:setMode", (_, payload) => {
    if (typeof payload === "string") {
      return setPetMode(payload);
    }

    return setPetMode(payload.mode, payload.message, { force: Boolean(payload.force) });
  });
  ipcMain.handle("pet:openMain", () => {
    showMainWindow();
    return setPetMode("main-open", "主页面已打开，我也在旁边待命。");
  });
  ipcMain.handle("pet:setPointerMode", (_, mode) => setPetPointerMode(mode));
  ipcMain.handle("pet:moveBy", (_, delta) => movePetWindow(delta));
  ipcMain.handle("pet:getManifest", () => loadPetManifest());
  ipcMain.handle("pet:hide", () => {
    hidePetWindow();
    return { ok: true };
  });
  ipcMain.handle("pet:resetPosition", () => {
    const bounds = clampPetBounds(defaultPetWindowSize, screen.getAllDisplays());
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setBounds(bounds);
    }
    settingsStore.update({ pet: { x: bounds.x, y: bounds.y } });
    return { ok: true, bounds };
  });
  ipcMain.handle("pet:quit", () => handleCloseChoice("quit"));
  ipcMain.handle("knowledge:search", (_, query) => knowledgeService.search(query));
  ipcMain.handle("knowledge:listRecent", (_, query) => knowledgeService.listRecent(query));
  ipcMain.handle("knowledge:update", (_, id, patch) => knowledgeService.update(id, patch));
  ipcMain.handle("knowledge:confirmAction", (_, actionId, approved) => knowledgeService.confirmAction(actionId, approved));
  ipcMain.handle("knowledge:open", (_, id) => knowledgeService.open(id));
  ipcMain.handle("knowledge:copy", (_, id) => knowledgeService.copy(id));
  ipcMain.handle("harness:status", () => harnessRuntime.getStatus());
  ipcMain.handle("harness:install", () => harnessRuntime.install());
  ipcMain.handle("harness:start", () => harnessRuntime.start());
  ipcMain.handle("harness:sendMessage", (_, payload) => chatAgent.sendMessage(payload));
  ipcMain.handle("harness:stop", () => chatAgent.stop());
  ipcMain.handle("harness:listSessions", () => chatAgent.listSessions());
  ipcMain.handle("harness:listMessages", (_, sessionId) => chatAgent.listMessages(sessionId));
}

function registerHotkeys(hotkeys) {
  try {
    return registerGlobalHotkeys(
      globalShortcut,
      hotkeys,
      {
        screenshot: () => screenshotController?.startRegionCapture(),
        clipboardHistory: () => {
          showMainWindow();
          sendEvent("clipboard:show-history", {});
          setPetMode("clipboard-text", "粘贴历史已打开。");
        },
      },
      (type, success, message) => database.logEvent(type, success, message),
    );
  } catch (error) {
    database?.logEvent("hotkey.register.invalid", false, error.message);
    return {
      screenshot: { accelerator: hotkeys?.screenshot ?? "", registered: false, error: error.message },
      clipboardHistory: { accelerator: hotkeys?.clipboardHistory ?? "", registered: false, error: error.message },
    };
  }
}

function handleCloseChoice(choice) {
  appendMainLog("window.closeChoice", { choice });
  if (choice === "show-main") {
    showMainWindow();
    return { ok: true };
  }

  if (choice === "pet-only") {
    mainWindow?.hide();
    showPetWindow();
    setPetMode("idle", "我会留在桌面上。");
    return { ok: true };
  }

  if (choice === "minimize-to-tray") {
    mainWindow?.hide();
    setPetMode("sleep", "我先在托盘待命。");
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
  hidePetWindow();
  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function showPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow(settingsStore.load());
  }
  const bounds = clampPetBounds(petWindow.getBounds(), screen.getAllDisplays());
  petWindow.setBounds(bounds);
  setPetPointerMode("interactive");
  petWindow.show();
}

function hidePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
}

function setPetPointerMode(mode) {
  if (!petWindow || petWindow.isDestroyed()) {
    return { ok: false, message: "pet window is not open" };
  }

  if (mode === "interactive") {
    petWindow.setIgnoreMouseEvents(false);
    return { ok: true, mode };
  }

  petWindow.setIgnoreMouseEvents(true, { forward: true });
  return { ok: true, mode: "passthrough" };
}

function movePetWindow(delta) {
  if (!petWindow || petWindow.isDestroyed()) {
    return { ok: false, message: "pet window is not open" };
  }

  const next = movePetBounds(petWindow.getBounds(), delta ?? {}, screen.getAllDisplays());
  petWindow.setBounds(next);
  settingsStore.update({ pet: { x: next.x, y: next.y } });
  return { ok: true, bounds: next };
}

function setPetMode(mode, message = "", options = {}) {
  if (!options.force && !petState.canInterruptWith(mode)) {
    return petState.snapshot();
  }

  const state = petState.setMode(mode, message);
  showPetForWorkEvent(state);
  setPetState(state);
  return state;
}

function showPetForWorkEvent(state) {
  if (state.layer !== "work") {
    return;
  }

  if (!settingsStore.load().pet.enabled) {
    return;
  }

  showPetWindow();
}

function setPetState(state) {
  sendToWindow(petWindow, "pet:event", state);
  sendToWindow(mainWindow, "pet:event", state);
}

function sendEvent(event, payload) {
  sendToWindow(mainWindow, event, payload);
  sendToWindow(petWindow, event, payload);
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

  await window.loadFile(path.join(process.cwd(), "dist", "renderer", "index.html"), { hash: hash.replace("#", "") });
}

async function waitForHarnessReady({ timeoutMs = 45000, intervalMs = 500 } = {}) {
  const startedAt = Date.now();
  let lastError = new Error("Harness is not ready");

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(harnessClientUrl);
      if (response.ok) {
        return true;
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
