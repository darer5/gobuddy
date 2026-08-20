import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { AnnotationStore, createWebContext, normalizeWebUrl } from "./web-canvas-core.mjs";

const MIN_VIEW_SIZE = 80;

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
    contents.on("did-finish-load", () => void this.refreshContext().then(() => this.restoreAnnotations()));
    contents.on("render-process-gone", (_event, details) => {
      this.emit("web-canvas:error", { message: `网页渲染进程已退出：${details.reason}` });
    });
    this.mainWindow.contentView.addChildView(this.view);
    return this.view;
  }

  async open(payload = {}) {
    const view = this.ensureView();
    this.visible = true;
    view.setVisible(true);
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

  setTool(tool) {
    this.view?.webContents.send("web-canvas:set-tool", String(tool || "select"));
    return { ok: true };
  }

  undo() {
    this.view?.webContents.send("web-canvas:undo");
    return { ok: true };
  }

  deleteAnnotation(id) {
    const removed = this.store.remove(String(id));
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
    const item = this.store.upsert({
      ...annotation,
      pageIdentity: this.currentContext.pageIdentity,
      url: this.currentContext.canonicalUrl,
      site: this.currentContext.site,
      adapter: this.currentContext.adapter,
      entity: this.currentContext.entity,
    });
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
    if (!this.view || !this.currentContext) throw new Error("Web Canvas 当前没有可截图的页面。");
    const image = await this.view.webContents.capturePage();
    const dir = path.join(path.dirname(this.store.filePath), "captures");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `web-canvas-${Date.now()}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    const size = image.getSize();
    return { filePath, width: size.width, height: size.height, capturedAt: Date.now() };
  }

  restoreAnnotations() {
    if (!this.currentContext || !this.view) return;
    this.annotationStatuses.clear();
    this.view.webContents.send("web-canvas:restore", this.store.list(this.currentContext.pageIdentity));
  }

  getState() {
    return {
      visible: this.visible,
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
