import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { AnnotationStore, createWebContext, normalizeWebUrl } from "./web-canvas-core.mjs";

const MIN_VIEW_SIZE = 80;
const MIN_CAPTURE_SIZE = 8;
const MAX_CAPTURE_EDGE = 1600;

export class WebCanvasController {
  constructor({ mainWindow, WebContentsView, session, shell, userDataPath, preloadPath, sendEvent }) {
    this.mainWindow = mainWindow;
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.shell = shell;
    this.preloadPath = preloadPath;
    this.sendEvent = sendEvent;
    this.store = new AnnotationStore(path.join(userDataPath, "web-canvas", "annotations.json"));
    this.currentContext = null;
    this.recentContexts = [];
    this.annotationStatuses = new Map();
    this.view = null;
    this.visible = false;
    this.suspended = false;
    this.readingMode = true;
    this.tool = "select";
    this.bridgeServer = null;
    this.bridgeToken = crypto.randomBytes(24).toString("hex");
    this.bridgeUrl = "";
  }

  async startBridge() {
    if (this.bridgeServer) return this.getBridgeEnv();
    this.bridgeServer = http.createServer((req, res) => void this.handleBridgeRequest(req, res));
    await new Promise((resolve, reject) => {
      this.bridgeServer.once("error", reject);
      this.bridgeServer.listen(0, "127.0.0.1", resolve);
    });
    const address = this.bridgeServer.address();
    this.bridgeUrl = `http://127.0.0.1:${address.port}`;
    return this.getBridgeEnv();
  }

  getBridgeEnv() {
    return {
      GOBUDDY_WEB_CANVAS_BRIDGE_URL: this.bridgeUrl,
      GOBUDDY_WEB_CANVAS_BRIDGE_TOKEN: this.bridgeToken,
    };
  }

  ensureView() {
    if (this.view) return this.view;
    const partition = "persist:gobuddy-web-canvas";
    const persistentSession = this.session.fromPartition(partition, { cache: true });
    this.view = new this.WebContentsView({
      webPreferences: {
        partition,
        session: persistentSession,
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      try {
        this.navigate(url);
      } catch {
        this.shell.openExternal(url).catch(() => {});
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      try { normalizeWebUrl(url); } catch { event.preventDefault(); }
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated"]) {
      contents.on(event, () => void this.refreshContext());
    }
    contents.on("did-finish-load", () => void this.refreshContext().then(() => {
      this.syncReadingMode();
      this.syncTool();
      this.restoreAnnotations();
    }));
    contents.on("render-process-gone", (_event, details) => {
      this.emit("web-canvas:error", { message: `网页渲染进程已退出：${details.reason}` });
    });
    this.mainWindow.contentView.addChildView(this.view);
    return this.view;
  }

  async open(payload = {}) {
    const view = this.ensureView();
    this.visible = true;
    view.setVisible(!this.suspended);
    if (payload.bounds) this.setBounds(payload.bounds);
    const target = normalizeWebUrl(payload.url || this.currentContext?.url);
    if (view.webContents.getURL() !== target) await view.webContents.loadURL(target);
    else await this.refreshContext();
    return this.getState();
  }

  close() {
    this.visible = false;
    this.view?.setVisible(false);
    return { ok: true };
  }

  setSuspended(value) {
    this.suspended = Boolean(value);
    this.view?.setVisible(this.visible && !this.suspended);
    return { ok: true, suspended: this.suspended };
  }

  destroy() {
    this.bridgeServer?.close();
    this.bridgeServer = null;
    if (this.view) {
      this.mainWindow?.contentView?.removeChildView(this.view);
      this.view.webContents.close();
      this.view = null;
    }
  }

  setBounds(bounds) {
    if (!this.view || !this.visible) return { ok: false };
    const scale = this.mainWindow.webContents.getZoomFactor() || 1;
    const normalized = {
      x: Math.max(0, Math.round(Number(bounds.x) * scale)),
      y: Math.max(0, Math.round(Number(bounds.y) * scale)),
      width: Math.max(MIN_VIEW_SIZE, Math.round(Number(bounds.width) * scale)),
      height: Math.max(MIN_VIEW_SIZE, Math.round(Number(bounds.height) * scale)),
    };
    this.view.setBounds(normalized);
    return { ok: true, bounds: normalized };
  }

  async navigate(input) {
    const url = normalizeWebUrl(typeof input === "string" ? input : input?.url);
    this.ensureView();
    await this.view.webContents.loadURL(url);
    return this.getState();
  }

  goBack() {
    if (this.view?.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack();
  }

  goForward() {
    if (this.view?.webContents.navigationHistory.canGoForward()) this.view.webContents.navigationHistory.goForward();
  }

  reload() {
    this.view?.webContents.reload();
  }

  setReadingMode(value) {
    this.readingMode = Boolean(value);
    this.syncReadingMode();
    this.emitState();
    return { ok: true, readingMode: this.readingMode };
  }

  syncReadingMode() {
    this.view?.webContents.send("web-canvas:reading-mode", this.readingMode);
  }

  setTool(tool) {
    this.tool = new Set(["select", "region", "rectangle", "arrow", "freehand"]).has(tool) ? tool : "select";
    this.syncTool();
    return { ok: true, tool: this.tool };
  }

  syncTool() {
    this.view?.webContents.send("web-canvas:set-tool", this.tool);
  }

  undo() {
    this.view?.webContents.send("web-canvas:undo");
    return { ok: true };
  }

  deleteAnnotation(id) {
    const existing = this.store.list().find((item) => item.id === String(id));
    const removed = this.store.remove(String(id));
    if (removed) this.removeCapture(existing?.capturePath);
    this.view?.webContents.send("web-canvas:delete", String(id));
    this.emitState();
    return { ok: removed };
  }

  focusAnnotation(id) {
    this.view?.webContents.send("web-canvas:focus", String(id));
    return { ok: true };
  }

  saveAnnotation(annotation) {
    if (!this.currentContext) return null;
    const existing = this.store.list().find((item) => item.id === annotation?.id);
    const capturePath = this.isCapturePath(annotation?.capturePath) ? annotation.capturePath : undefined;
    const item = this.store.upsert({
      ...annotation,
      capturePath,
      pageIdentity: this.currentContext.pageIdentity,
      url: this.currentContext.canonicalUrl,
      site: this.currentContext.site,
      adapter: this.currentContext.adapter,
      entity: this.currentContext.entity,
    });
    if (existing?.capturePath && existing.capturePath !== item.capturePath) {
      this.removeCapture(existing.capturePath);
    }
    this.emitState();
    return item;
  }

  setAnnotationStatus({ id, status }) {
    if (!id) return;
    this.annotationStatuses.set(String(id), status === "orphaned" ? "orphaned" : "restored");
    this.emitState();
  }

  async refreshContext() {
    if (!this.view || this.view.webContents.isDestroyed() || !this.view.webContents.getURL()) return null;
    let snapshot;
    try {
      snapshot = await this.view.webContents.executeJavaScript(`(() => {
        const selection = window.getSelection();
        const selectedText = selection && !selection.isCollapsed ? String(selection).slice(0, 4000) : "";
        const bodyText = document.body ? document.body.innerText : "";
        return {
          url: location.href,
          title: document.title,
          visibleText: bodyText.slice(0, 16000),
          selection: selectedText ? { text: selectedText } : null,
          viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio },
        };
      })()`, true);
    } catch {
      snapshot = { url: this.view.webContents.getURL(), title: this.view.webContents.getTitle(), visibleText: "" };
    }
    snapshot.navigation = {
      canGoBack: this.view.webContents.navigationHistory.canGoBack(),
      canGoForward: this.view.webContents.navigationHistory.canGoForward(),
      loading: this.view.webContents.isLoading(),
    };
    const previous = this.currentContext;
    const next = createWebContext(snapshot, previous);
    if (previous?.canonicalUrl === next.canonicalUrl) {
      next.previousEntity = previous.previousEntity;
    }
    if (!previous || previous.canonicalUrl !== next.canonicalUrl) {
      if (previous) this.recentContexts.unshift(previous);
      this.recentContexts = this.recentContexts.slice(0, 10);
    }
    this.currentContext = next;
    this.emitState();
    return next;
  }

  async captureViewport() {
    if (!this.view || !this.currentContext) throw new Error("PageLens 当前没有可截图的页面。");
    const image = await this.view.webContents.capturePage();
    const dir = path.join(path.dirname(this.store.filePath), "captures");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `web-canvas-${Date.now()}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    const size = image.getSize();
    return { filePath, width: size.width, height: size.height, capturedAt: Date.now() };
  }

  async captureRegion(rawGeometry) {
    if (!this.view || !this.currentContext) throw new Error("PageLens 当前没有可截图的页面。");
    const content = this.view.webContents.getOwnerBrowserWindow?.()?.getContentBounds?.();
    const viewBounds = this.view.getBounds?.() ?? { width: content?.width, height: content?.height };
    const geometry = normalizeCaptureGeometry(rawGeometry, viewBounds);
    let image = await this.view.webContents.capturePage(geometry);
    const original = image.getSize();
    const ratio = Math.min(1, MAX_CAPTURE_EDGE / Math.max(original.width, original.height));
    if (ratio < 1) {
      image = image.resize({
        width: Math.max(1, Math.round(original.width * ratio)),
        height: Math.max(1, Math.round(original.height * ratio)),
      });
    }
    const dir = this.captureDirectory();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `web-canvas-region-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    const size = image.getSize();
    return { filePath, width: size.width, height: size.height, capturedAt: Date.now() };
  }

  readAnnotationCapture(id) {
    const item = this.store.list(this.currentContext?.pageIdentity).find((entry) => entry.id === String(id));
    const filePath = item?.capturePath;
    if (!this.isCapturePath(filePath) || !fs.existsSync(filePath)) {
      throw new Error("标记截图不存在，请重新框选行情区域。");
    }
    const bytes = fs.readFileSync(filePath);
    return {
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      fileName: path.basename(filePath),
      filePath,
    };
  }

  captureDirectory() {
    return path.join(path.dirname(this.store.filePath), "captures");
  }

  isCapturePath(filePath) {
    if (!filePath) return false;
    const root = path.resolve(this.captureDirectory());
    const candidate = path.resolve(String(filePath));
    return candidate.startsWith(`${root}${path.sep}`);
  }

  removeCapture(filePath) {
    if (!this.isCapturePath(filePath)) return;
    try { fs.unlinkSync(filePath); } catch (error) {
      if (error?.code !== "ENOENT") this.emit("web-canvas:error", { message: "无法清理旧的行情截图。" });
    }
  }

  restoreAnnotations() {
    if (!this.currentContext || !this.view) return;
    this.annotationStatuses.clear();
    this.view.webContents.send("web-canvas:restore", this.store.list(this.currentContext.pageIdentity));
  }

  getState() {
    return {
      visible: this.visible,
      suspended: this.suspended,
      readingMode: this.readingMode,
      context: this.currentContext,
      annotations: this.store.list(this.currentContext?.pageIdentity).map((item) => ({
        ...item,
        status: this.annotationStatuses.get(item.id) ?? "restored",
      })),
      recentContexts: this.recentContexts,
    };
  }

  emitState() {
    this.emit("web-canvas:state", this.getState());
  }

  emit(event, payload) {
    this.sendEvent?.(event, payload);
  }

  async handleBridgeRequest(req, res) {
    if (req.headers.authorization !== `Bearer ${this.bridgeToken}`) return json(res, 401, { error: "unauthorized" });
    try {
      const url = new URL(req.url || "/", this.bridgeUrl || "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/context") return json(res, 200, this.currentContext ?? { active: false });
      if (req.method === "GET" && url.pathname === "/annotations") return json(res, 200, this.getState().annotations);
      if (req.method === "GET" && url.pathname === "/recent-contexts") return json(res, 200, this.recentContexts);
      const body = await readJson(req);
      if (req.method === "POST" && url.pathname === "/navigate") return json(res, 200, await this.navigate(body));
      if (req.method === "POST" && url.pathname === "/focus") return json(res, 200, this.focusAnnotation(body.id));
      if (req.method === "POST" && url.pathname === "/capture") return json(res, 200, await this.captureViewport());
      return json(res, 404, { error: "not found" });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 64 * 1024) reject(new Error("request too large"));
    });
    req.on("end", () => {
      try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function normalizeCaptureGeometry(raw, bounds = {}) {
  const maxWidth = Math.max(MIN_CAPTURE_SIZE, Math.floor(Number(bounds.width) || 10000));
  const maxHeight = Math.max(MIN_CAPTURE_SIZE, Math.floor(Number(bounds.height) || 10000));
  const x = Math.max(0, Math.min(maxWidth - MIN_CAPTURE_SIZE, Math.floor(Number(raw?.x) || 0)));
  const y = Math.max(0, Math.min(maxHeight - MIN_CAPTURE_SIZE, Math.floor(Number(raw?.y) || 0)));
  const width = Math.max(MIN_CAPTURE_SIZE, Math.min(maxWidth - x, Math.ceil(Number(raw?.width) || 0)));
  const height = Math.max(MIN_CAPTURE_SIZE, Math.min(maxHeight - y, Math.ceil(Number(raw?.height) || 0)));
  return { x, y, width, height };
}
