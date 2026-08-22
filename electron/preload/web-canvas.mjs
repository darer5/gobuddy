const { ipcRenderer } = require("electron");

const ROOT_ID = "__gobuddy_web_canvas_annotations__";
const STYLE_ID = "__gobuddy_web_canvas_styles__";
const READING_STYLE_ID = "__gobuddy_web_canvas_reading_styles__";
const DRAW_TOOLS = new Set(["rectangle", "arrow", "freehand", "region"]);
const HIGHLIGHT_COLORS = new Set(["yellow", "green", "blue"]);
const DEFAULT_HIGHLIGHT_COLOR = "yellow";
let tool = "select";
let start = null;
let draft = null;
let annotations = [];
let pendingSelection = null;
let pendingImage = null;
let composer = null;
let composerDrag = null;
let renderFrame = 0;
let readingMode = true;
let activePointerId = null;
let readingObserver = null;
let readingLayoutTimer = 0;

window.addEventListener("DOMContentLoaded", mount, { once: true });
ipcRenderer.on("web-canvas:set-tool", (_event, value) => {
  tool = DRAW_TOOLS.has(value) ? value : "select";
  pendingSelection = null;
  pendingImage = null;
  composer = null;
  composerDrag = null;
  syncMode();
  render();
});
ipcRenderer.on("web-canvas:reading-mode", (_event, value) => {
  readingMode = Boolean(value);
  applyReadingMode();
});
ipcRenderer.on("web-canvas:restore", (_event, items) => {
  annotations = (Array.isArray(items) ? items : []).map(restoreAnnotation);
  for (const item of annotations) {
    ipcRenderer.send("web-canvas:annotation-status", { id: item.id, status: item.status });
  }
  render();
});
ipcRenderer.on("web-canvas:delete", (_event, id) => {
  annotations = annotations.filter((item) => item.id !== id);
  render();
});
ipcRenderer.on("web-canvas:undo", () => {
  const item = annotations.pop();
  if (item) ipcRenderer.send("web-canvas:annotation-delete", item.id);
  render();
});
ipcRenderer.on("web-canvas:focus", (_event, id) => {
  const node = document.querySelector(`[data-wca-id="${cssEscape(id)}"]`);
  if (!node) return;
  node.scrollIntoView?.({ block: "center", behavior: "smooth" });
  node.animate([{ opacity: 1 }, { opacity: 0.18 }, { opacity: 1 }], { duration: 900 });
});

function mount() {
  if (!document.documentElement || document.getElementById(ROOT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    html[data-wca-mode="draw"] #${ROOT_ID}{pointer-events:auto;cursor:crosshair;touch-action:none;user-select:none}
    .wca-shape{position:absolute;box-sizing:border-box;pointer-events:none}
    .wca-rectangle{border:2px solid #ff9f2f;background:rgba(255,159,47,.10);border-radius:4px}
    .wca-highlight{border-radius:2px;mix-blend-mode:multiply}
    .wca-highlight-yellow{background:rgba(255,214,74,.48);border-bottom:2px solid #e9ac00}
    .wca-highlight-green{background:rgba(109,211,151,.38);border-bottom:2px solid #35a766}
    .wca-highlight-blue{background:rgba(102,167,255,.34);border-bottom:2px solid #4b88dd}
    .wca-image-anchor{border:3px solid #e9ac00;border-radius:8px;background:rgba(255,214,74,.08);box-shadow:0 0 0 2px #fff8}
    .wca-image-anchor.wca-highlight-green{border-color:#35a766}.wca-image-anchor.wca-highlight-blue{border-color:#4b88dd}
    .wca-question,.wca-note-marker{width:26px!important;height:26px!important;border-radius:50%;display:grid;place-items:center;pointer-events:auto;cursor:pointer;color:#fff;font:700 13px/1 system-ui;box-shadow:0 3px 12px #0004}
    .wca-question{background:#315ed1}.wca-note-marker{background:#d69b00}
    .wca-text{max-width:260px;padding:7px 9px;border-radius:7px;background:#fff8d6;color:#342d16;border:1px solid #e4c85c;font:12px/1.4 system-ui;box-shadow:0 3px 10px #0003}
    .wca-stroke{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
    .wca-stroke path,.wca-stroke polyline{fill:none;stroke:#ff6b35;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .wca-active{outline:3px solid #5b8cff!important;outline-offset:2px}
    .wca-selection-menu{position:fixed;z-index:3;display:flex;align-items:center;gap:5px;min-height:40px;padding:5px 7px;border:1px solid #d8ddd6;border-radius:11px;background:#fff;color:#1e2924;box-shadow:0 8px 28px #15231c33;pointer-events:auto}
    .wca-selection-menu button{height:30px;border:0;border-radius:7px;background:transparent;color:inherit;padding:0 9px;font:12px system-ui;cursor:pointer}.wca-selection-menu button:hover{background:#eef1ec}.wca-selection-menu button:focus-visible,.wca-composer button:focus-visible{outline:2px solid #78905d;outline-offset:2px}
    .wca-color{width:24px!important;height:24px!important;padding:0!important;border:2px solid #fff!important;border-radius:6px!important;box-shadow:0 0 0 1px #bcc5bc!important}.wca-color:hover{transform:translateY(-1px)}.wca-color[aria-pressed="true"]{box-shadow:0 0 0 2px #1c2722!important}.wca-color[data-color="yellow"]{background:#f6cf4f}.wca-color[data-color="green"]{background:#69c98f}.wca-color[data-color="blue"]{background:#6b9fe8}
    .wca-selection-menu .wca-divider{width:1px;height:20px;background:#dfe3dd;margin:0 2px}
    .wca-composer{position:fixed;z-index:4;width:min(310px,calc(100vw - 24px));box-sizing:border-box;padding:10px;border:1px solid #d8ddd6;border-radius:12px;background:#fff;color:#1e2924;box-shadow:0 12px 36px #15231c3d;pointer-events:auto}
    .wca-composer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px -4px 2px;padding:4px;border-radius:7px;cursor:grab;touch-action:none;user-select:none}.wca-composer-head:active{cursor:grabbing}.wca-composer-head strong{display:block;margin:0;font:600 12px system-ui}.wca-composer-drag{color:#8a958e;font:10px system-ui}
    .wca-composer-hint{margin:0 0 8px;color:#728078;font:11px/1.4 system-ui}.wca-composer textarea{display:block;width:100%;height:76px;resize:vertical;box-sizing:border-box;border:1px solid #ccd3ca;border-radius:8px;padding:8px;outline:none;font:12px/1.45 system-ui}.wca-composer textarea:focus{border-color:#6f8f58;box-shadow:0 0 0 2px #e7f4d5}
    .wca-composer-colors{display:flex;align-items:center;gap:7px;margin-top:9px}.wca-composer-colors span{margin-right:2px;color:#728078;font:11px system-ui}.wca-composer-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:9px}.wca-composer-actions button{height:30px;border:1px solid #d8ddd6;border-radius:7px;background:#fff;padding:0 10px;color:#334039;font:12px system-ui;cursor:pointer}.wca-composer-actions button[data-primary]{background:#1c2722;color:#fff;border-color:#1c2722}.wca-composer-actions button[data-danger]{margin-right:auto;color:#b42318;border-color:#efc5c0}
  `;
  document.documentElement.appendChild(style);
  const readingStyle = document.createElement("style");
  readingStyle.id = READING_STYLE_ID;
  readingStyle.textContent = `
    html[data-wca-reading="true"][data-wca-article="true"],html[data-wca-reading="true"][data-wca-article="true"] body{width:100%!important;min-width:0!important;max-width:100vw!important;overflow-x:clip!important}
    html[data-wca-reading="true"][data-wca-article="true"] img,html[data-wca-reading="true"][data-wca-article="true"] video,html[data-wca-reading="true"][data-wca-article="true"] iframe{max-width:100%!important;height:auto!important}
    html[data-wca-reading="true"][data-wca-article="true"] .home__col--rt{display:none!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(article,.article,.oneColumn,.article__page,.article_out_container,.article__container,.header,.content,.container,.padding,.footer_wrap,#UCAP-CONTENT,.pages_content,.trs_editor_view){width:auto!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(article,.article.oneColumn,.article__bd,.article__bd__detail,.article__comment){width:min(720px,calc(100vw - 32px))!important;min-width:0!important;max-width:720px!important;margin-left:auto!important;margin-right:auto!important;box-sizing:border-box!important}
    html[data-wca-reading="true"][data-wca-article="true"] .article.oneColumn{padding-left:clamp(16px,4vw,40px)!important;padding-right:clamp(16px,4vw,40px)!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(#UCAP-CONTENT,.pages_content){width:100%!important;min-width:0!important;max-width:720px!important;margin-left:auto!important;margin-right:auto!important;box-sizing:border-box!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(h1,#ti){width:auto!important;max-width:100%!important;overflow-wrap:anywhere!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(.pages-date,.pages_print){width:auto!important;max-width:100%!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(p,li,blockquote,pre,table){max-width:100%!important;overflow-wrap:anywhere!important}
    html[data-wca-reading="true"][data-wca-article="true"] :is(#UCAP-CONTENT,.pages_content,.trs_editor_view) p{font-size:18px!important;line-height:1.8!important}
    html[data-wca-reading="true"][data-wca-article="true"] [data-wca-reader-hidden]{display:none!important}
    html[data-wca-reading="true"][data-wca-article="true"] [data-wca-reader-shell]{width:100%!important;min-width:0!important;max-width:100%!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box!important;grid-template-columns:minmax(0,1fr)!important}
    html[data-wca-reading="true"][data-wca-article="true"] [data-wca-reader-root]{position:relative!important;inset:auto!important;float:none!important;transform:none!important;display:block!important;width:min(760px,calc(100vw - 32px))!important;min-width:0!important;max-width:760px!important;margin:0 auto!important;padding-left:clamp(16px,3vw,32px)!important;padding-right:clamp(16px,3vw,32px)!important;box-sizing:border-box!important;overflow:visible!important}
    html[data-wca-reading="true"][data-wca-article="true"] [data-wca-reader-root] :is(img,video,svg,canvas){max-width:100%!important;height:auto!important}
    html[data-wca-reading="true"][data-wca-article="true"] [data-wca-reader-root] :is(table,pre){display:block!important;max-width:100%!important;overflow-x:auto!important;white-space:pre-wrap!important}
  `;
  document.documentElement.appendChild(readingStyle);
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("click", onOverlayClick);
  root.addEventListener("input", onOverlayInput);
  document.documentElement.appendChild(root);
  document.addEventListener("selectionchange", reportSelection);
  document.addEventListener("pointerup", onDocumentPointerUp, true);
  document.addEventListener("pointermove", onDocumentPointerMove, true);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", scheduleRender, true);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("resize", scheduleReadingLayout);
  syncMode();
  applyReadingMode();
  readingObserver = new MutationObserver(scheduleReadingLayout);
  if (document.body) readingObserver.observe(document.body, { childList: true, subtree: true });
  render();
}

function applyReadingMode() {
  if (!document.documentElement) return;
  document.documentElement.dataset.wcaReading = String(readingMode);
  if (!readingMode) {
    clearReadingLayout();
    document.documentElement.dataset.wcaArticle = "false";
    return;
  }
  refreshReadingLayout();
}

function scheduleReadingLayout() {
  if (!readingMode || readingLayoutTimer) return;
  readingLayoutTimer = window.setTimeout(() => {
    readingLayoutTimer = 0;
    refreshReadingLayout();
  }, 120);
}

function refreshReadingLayout() {
  clearReadingLayout();
  let root = findReadingRoot();
  document.documentElement.dataset.wcaArticle = String(Boolean(root));
  if (!root) return;
  root.dataset.wcaReaderRoot = "";
  let current = root.parentElement;
  while (current && current !== document.body) {
    current.dataset.wcaReaderShell = "";
    for (const sibling of current.children) {
      if (sibling !== root && !sibling.contains(root) && shouldHideReaderSibling(sibling)) sibling.dataset.wcaReaderHidden = "";
    }
    root = current;
    current = current.parentElement;
  }
}

function findReadingRoot() {
  const selectors = "article,#UCAP-CONTENT,.article__bd,.article__bd__detail,.article_out_container,.pages_content,main,[role=main]";
  const candidates = [...document.querySelectorAll(selectors)].filter((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 220 && box.height > 120;
  }).slice(0, 60);
  let best = null;
  let bestScore = 0;
  for (const element of candidates) {
    const text = String(element.innerText || "").trim().slice(0, 20000);
    const paragraphs = element.querySelectorAll("p").length;
    const linkText = [...element.querySelectorAll("a")].slice(0, 100).reduce((sum, link) => sum + String(link.innerText || "").length, 0);
    const score = text.length + paragraphs * 160 - linkText * 1.5 + (element.tagName === "ARTICLE" ? 1500 : 0);
    if (text.length >= 400 && score > bestScore) { best = element; bestScore = score; }
  }
  return best;
}

function shouldHideReaderSibling(element) {
  if (["SCRIPT", "STYLE", "LINK"].includes(element.tagName)) return false;
  const signature = `${element.tagName} ${element.getAttribute("role") || ""} ${element.id} ${element.className}`;
  return /\b(ASIDE|complementary|sidebar|side-bar|right[-_ ]?(col|column|rail)|recommend|related|advert|ad-wrap)\b/i.test(signature);
}

function clearReadingLayout() {
  for (const element of document.querySelectorAll("[data-wca-reader-root],[data-wca-reader-shell],[data-wca-reader-hidden]")) {
    delete element.dataset.wcaReaderRoot;
    delete element.dataset.wcaReaderShell;
    delete element.dataset.wcaReaderHidden;
  }
}

function syncMode() {
  if (!document.documentElement) return;
  if (DRAW_TOOLS.has(tool)) document.documentElement.dataset.wcaMode = "draw";
  else delete document.documentElement.dataset.wcaMode;
}

function onPointerDown(event) {
  const handle = event.target.closest?.("[data-wca-drag-handle]");
  if (handle && composer) {
    const panel = handle.closest(".wca-composer");
    const box = panel?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    composerDrag = { pointerId: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
    handle.setPointerCapture?.(event.pointerId);
    return;
  }
  if (!DRAW_TOOLS.has(tool) || event.button !== 0 || event.target.closest?.("button,textarea")) return;
  event.preventDefault();
  start = { x: event.clientX, y: event.clientY };
  activePointerId = event.pointerId;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  draft = tool === "freehand"
    ? { points: [{ x: event.clientX, y: event.clientY }] }
    : tool === "arrow"
      ? { x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY }
      : { x: event.clientX, y: event.clientY, width: 1, height: 1 };
  scheduleRender();
}

function onPointerMove(event) {
  if (composerDrag && composer) {
    event.preventDefault();
    const panel = document.querySelector(`#${ROOT_ID} .wca-composer`);
    const width = panel?.offsetWidth || Math.min(310, innerWidth - 24);
    const height = panel?.offsetHeight || 154;
    composer.position = {
      x: clamp(event.clientX - composerDrag.dx, 8, Math.max(8, innerWidth - width - 8)),
      y: clamp(event.clientY - composerDrag.dy, 8, Math.max(8, innerHeight - height - 8)),
    };
    if (panel) {
      panel.style.left = `${composer.position.x}px`;
      panel.style.top = `${composer.position.y}px`;
    }
    return;
  }
  if (!start || event.pointerId !== activePointerId) return;
  event.preventDefault();
  if (tool === "rectangle") draft = rect(start, { x: event.clientX, y: event.clientY });
  if (tool === "arrow") draft = { x1: start.x, y1: start.y, x2: event.clientX, y2: event.clientY };
  if (tool === "freehand") {
    const points = event.getCoalescedEvents?.() || [event];
    draft = { points: [...(draft?.points || []), ...points.map((point) => ({ x: point.clientX, y: point.clientY }))] };
  }
  if (tool === "region") draft = rect(start, { x: event.clientX, y: event.clientY });
  scheduleRender();
}

function onPointerUp(event) {
  if (composerDrag) {
    event.preventDefault();
    composerDrag = null;
    return;
  }
  if (!start || event.pointerId !== activePointerId) return;
  event.preventDefault();
  if (tool === "region") {
    const geometry = rect(start, { x: event.clientX, y: event.clientY });
    if (geometry.width >= 24 && geometry.height >= 24) {
      pendingSelection = {
        geometry: [geometry],
        selectedText: readRegionText(geometry),
        anchor: { kind: "visual-region", ...geometry, viewport: { width: innerWidth, height: innerHeight } },
      };
      pendingImage = null;
      composer = null;
    }
  } else if (tool === "rectangle") {
    const geometry = rect(start, { x: event.clientX, y: event.clientY });
    if (geometry.width >= 8 && geometry.height >= 8) create("rectangle", geometry);
  } else if (tool === "arrow") {
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) {
      create("arrow", { x1: start.x, y1: start.y, x2: event.clientX, y2: event.clientY });
    }
  } else if (tool === "freehand" && (draft?.points?.length || 0) >= 2) {
    create("freehand", draft);
  }
  start = null;
  draft = null;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
  activePointerId = null;
  render();
}

function onPointerCancel(event) {
  if (event.pointerId !== activePointerId) return;
  start = null;
  draft = null;
  activePointerId = null;
  scheduleRender();
}

function onDocumentPointerUp(event) {
  if (document.getElementById(ROOT_ID)?.contains(event.target) || DRAW_TOOLS.has(tool)) return;
  window.setTimeout(settleSelection, 0);
}

function settleSelection() {
  const snapshot = readSelection();
  if (!snapshot) {
    pendingSelection = null;
    if (!composer) render();
    return;
  }
  pendingSelection = snapshot;
  pendingImage = null;
  composer = null;
  render();
}

function readSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const exact = selection.toString().slice(0, 4000);
  if (!exact.trim()) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!container || container.closest?.(`#${ROOT_ID},input,textarea,[contenteditable="true"]`)) return null;
  const geometry = [...range.getClientRects()].filter(validBox).map(boxToGeometry);
  if (!geometry.length) return null;
  return { selectedText: exact.trim(), geometry, anchor: serializeRange(range, exact) };
}

function commitSelection() {
  if (!pendingSelection) return;
  openComposer("question");
}

function openComposer(type) {
  if (!pendingSelection) return;
  composer = { type, value: "", color: DEFAULT_HIGHLIGHT_COLOR, selection: pendingSelection };
  pendingImage = null;
  window.getSelection()?.removeAllRanges();
  render();
  window.setTimeout(() => document.querySelector(`#${ROOT_ID} textarea`)?.focus(), 0);
}

async function saveComposer() {
  const value = String(composer?.value || "").trim();
  if (!composer || composer.saving) return;
  composer.saving = true;
  composer.error = "";
  render();
  const selection = composer.selection;
  const current = composer.id ? annotations.find((item) => item.id === composer.id) : null;
  try {
    const capture = selection.anchor?.kind === "visual-region" && !current?.capturePath
      ? await captureVisualRegion(unionGeometry(selection.geometry))
      : null;
    persist({
      ...current,
      id: composer.id || annotationId(),
      type: "question",
      geometry: selection.geometry,
      anchor: selection.anchor,
      selectedText: selection.selectedText,
      imageUrl: selection.imageUrl,
      capturePath: capture?.filePath || current?.capturePath,
      capture: capture ? { width: capture.width, height: capture.height, capturedAt: capture.capturedAt } : current?.capture,
      question: value || undefined,
      color: normalizeColor(composer.color),
      createdAt: current?.createdAt || Date.now(),
    });
    clearSelectionUi();
  } catch {
    composer.saving = false;
    composer.error = "截图保存失败，请稍后重试。";
    render();
  }
}

function clearSelectionUi() {
  window.getSelection()?.removeAllRanges();
  pendingSelection = null;
  pendingImage = null;
  composer = null;
  render();
}

function onOverlayClick(event) {
  const control = event.target.closest?.("[data-wca-action]");
  const action = control?.dataset.wcaAction;
  if (!action) {
    const id = event.target.closest?.("[data-wca-id]")?.dataset.wcaId;
    const annotation = id && annotations.find((item) => item.id === id);
    if (annotation) openAnnotation(annotation);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (action === "question") commitSelection();
  if (action === "image-question") openImageComposer();
  if (action === "color") void savePlainHighlight(control.dataset.color);
  if (action === "composer-color" && composer) {
    composer.color = normalizeColor(control.dataset.color);
    render();
  }
  if (action === "save") void saveComposer();
  if (action === "delete") deleteComposerAnnotation();
  if (action === "cancel") clearSelectionUi();
}

function onOverlayInput(event) {
  if (composer && event.target.matches?.("textarea")) composer.value = event.target.value;
}

function onKeyDown(event) {
  if (event.key === "Escape" && (pendingSelection || composer)) {
    event.preventDefault();
    clearSelectionUi();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && composer) {
    event.preventDefault();
    saveComposer();
  }
}

function onDocumentPointerMove(event) {
  const root = document.getElementById(ROOT_ID);
  if (root?.contains(event.target) || composer || pendingSelection) return;
  const image = event.target.closest?.("img");
  const snapshot = image && readImage(image);
  const nextSrc = snapshot?.imageUrl;
  if (nextSrc === pendingImage?.imageUrl) return;
  pendingImage = snapshot;
  render();
}

function onDocumentClick(event) {
  const root = document.getElementById(ROOT_ID);
  if (root?.contains(event.target) || pendingSelection || composer) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  const annotation = annotationAtPoint(event.clientX, event.clientY);
  if (!annotation) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openAnnotation(annotation);
}

async function savePlainHighlight(color) {
  if (!pendingSelection || !HIGHLIGHT_COLORS.has(color)) return;
  const selection = pendingSelection;
  try {
    const capture = selection.anchor?.kind === "visual-region"
      ? await captureVisualRegion(unionGeometry(selection.geometry))
      : null;
    persist({
      id: annotationId(), type: "question", geometry: selection.geometry,
      anchor: selection.anchor, selectedText: selection.selectedText,
      imageUrl: selection.imageUrl, capturePath: capture?.filePath,
      capture: capture ? { width: capture.width, height: capture.height, capturedAt: capture.capturedAt } : undefined,
      color, createdAt: Date.now(),
    });
    clearSelectionUi();
  } catch {
    openComposer("question");
    composer.error = "截图保存失败，请稍后重试。";
    render();
  }
}

function openImageComposer() {
  if (!pendingImage) return;
  pendingSelection = pendingImage;
  openComposer("question");
}

function openAnnotation(item) {
  const geometry = annotationGeometry(item);
  if (!geometry.length) return;
  pendingSelection = null;
  pendingImage = null;
  composer = {
    id: item.id,
    value: String(item.question || ""),
    color: normalizeColor(item.color),
    selection: {
      geometry,
      anchor: item.anchor,
      selectedText: item.selectedText,
      imageUrl: item.imageUrl || item.anchor?.src,
    },
  };
  render();
  window.setTimeout(() => document.querySelector(`#${ROOT_ID} textarea`)?.focus(), 0);
}

function deleteComposerAnnotation() {
  if (!composer?.id) return;
  const id = composer.id;
  annotations = annotations.filter((item) => item.id !== id);
  ipcRenderer.send("web-canvas:annotation-delete", id);
  clearSelectionUi();
}

function create(type, geometry, extra = {}) {
  persist({
    id: annotationId(),
    type,
    geometry,
    anchor: extra.anchor || { kind: "viewport-region", ...geometry, viewport: { width: innerWidth, height: innerHeight } },
    note: extra.note,
    question: extra.question,
    selectedText: extra.selectedText,
    color: extra.color,
    createdAt: Date.now(),
  });
}

function persist(annotation) {
  const index = annotations.findIndex((item) => item.id === annotation.id);
  const local = { ...annotation, status: "restored" };
  if (index >= 0) annotations[index] = local;
  else annotations.push(local);
  ipcRenderer.send("web-canvas:annotation-create", annotation);
  render();
}

function annotationId() {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    render();
  });
}

function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.replaceChildren();
  for (const item of annotations) renderAnnotation(root, item);
  if (draft && start) renderDraft(root);
  if (pendingSelection && !composer) renderSelectionMenu(root, pendingSelection);
  if (pendingImage && !pendingSelection && !composer) renderImageMenu(root, pendingImage);
  if (composer) renderComposer(root, composer);
}

function renderDraft(root) {
  if (tool === "arrow" || tool === "freehand") renderStroke(root, "draft", tool, draft);
  else renderBox(root, "draft", tool === "region" ? "rectangle" : tool, draft);
}

function renderAnnotation(root, item) {
  if (item.type === "arrow" || item.type === "freehand") {
    if (item.status !== "orphaned") renderStroke(root, item.id, item.type, item.geometry);
    return;
  }
  const geometries = annotationGeometry(item);
  if (!geometries?.length) return;
  if (item.type === "highlight") {
    for (const geometry of geometries) renderBox(root, item.id, `highlight highlight-${normalizeColor(item.color)}`, geometry);
    return;
  }
  if (item.type === "question" && ["text-range", "image"].includes(item.anchor?.kind)) {
    const anchorType = item.anchor.kind === "image" ? "image-anchor" : "highlight";
    for (const geometry of geometries) {
      renderBox(root, item.id, `${anchorType} highlight-${normalizeColor(item.color)}`, geometry);
    }
    if (!String(item.question || "").trim()) return;
    const last = geometries.at(-1);
    const marker = renderBox(root, item.id, "question", {
      x: Math.min(innerWidth - 30, last.x + last.width + 4),
      y: Math.max(2, last.y + last.height / 2 - 13), width: 26, height: 26,
    });
    marker.textContent = "?";
    marker.title = item.question;
    return;
  }
  if (item.type === "question" && item.anchor?.kind === "visual-region") {
    for (const geometry of geometries) renderBox(root, item.id, `image-anchor highlight-${normalizeColor(item.color)}`, geometry);
    if (!String(item.question || "").trim()) return;
    const last = geometries.at(-1);
    const marker = renderBox(root, item.id, "question", {
      x: Math.min(innerWidth - 30, last.x + last.width + 4),
      y: Math.max(2, last.y + last.height / 2 - 13), width: 26, height: 26,
    });
    marker.textContent = "?";
    marker.title = item.question;
    return;
  }
  for (const geometry of geometries) {
    const node = renderBox(root, item.id, item.type, geometry);
    if (item.type === "question") node.textContent = "?";
    if (item.type === "text") node.textContent = item.note || "笔记";
  }
}

function renderSelectionMenu(root, selection) {
  const box = unionGeometry(selection.geometry);
  if (selection.anchor?.kind === "visual-region") renderBox(root, "pending-region", "rectangle", box);
  const menu = document.createElement("div");
  menu.className = "wca-selection-menu";
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("aria-label", "标记所选内容");
  const estimatedWidth = 154;
  menu.style.left = `${clamp(box.x + box.width / 2 - estimatedWidth / 2, 8, innerWidth - estimatedWidth - 8)}px`;
  menu.style.top = `${box.y > 54 ? box.y - 48 : Math.min(innerHeight - 48, box.y + box.height + 8)}px`;
  for (const color of HIGHLIGHT_COLORS) menu.appendChild(colorButton("color", color));
  const divider = document.createElement("span");
  divider.className = "wca-divider";
  divider.setAttribute("aria-hidden", "true");
  menu.appendChild(divider);
  menu.appendChild(actionButton("question", "提问"));
  root.appendChild(menu);
}

function renderImageMenu(root, image) {
  const box = unionGeometry(image.geometry);
  renderBox(root, "pending-image", "image-anchor highlight-blue", box);
  const menu = document.createElement("div");
  menu.className = "wca-selection-menu";
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("aria-label", "标记图片");
  menu.style.left = `${clamp(box.x + box.width - 58, 8, innerWidth - 66)}px`;
  menu.style.top = `${clamp(box.y + 8, 8, innerHeight - 48)}px`;
  menu.appendChild(actionButton("image-question", "提问"));
  root.appendChild(menu);
}

function renderComposer(root, state) {
  const box = unionGeometry(state.selection.geometry);
  const panel = document.createElement("div");
  panel.className = "wca-composer";
  const position = state.position || {
    x: clamp(box.x + box.width / 2 - 155, 8, Math.max(8, innerWidth - 318)),
    y: clamp(box.y + box.height + 10, 8, Math.max(8, innerHeight - 154)),
  };
  panel.style.left = `${clamp(position.x, 8, Math.max(8, innerWidth - 318))}px`;
  panel.style.top = `${clamp(position.y, 8, Math.max(8, innerHeight - 154))}px`;
  const head = document.createElement("div");
  head.className = "wca-composer-head";
  head.dataset.wcaDragHandle = "";
  const title = document.createElement("strong");
  title.textContent = state.id ? "修改标记" : "保存标记";
  const dragHint = document.createElement("span");
  dragHint.className = "wca-composer-drag";
  dragHint.textContent = "拖动";
  head.append(title, dragHint);
  const hint = document.createElement("p");
  hint.className = "wca-composer-hint";
  hint.textContent = state.error || (state.selection.anchor?.kind === "visual-region"
    ? "将保存框内截图和可见行情文字；问题可以留空。"
    : "问题可留空；留空时仅保留标记区域。");
  const textarea = document.createElement("textarea");
  textarea.value = state.value;
  textarea.placeholder = "可选：输入希望 AI 分析的问题…";
  textarea.maxLength = 4000;
  const colors = document.createElement("div");
  colors.className = "wca-composer-colors";
  const colorLabel = document.createElement("span");
  colorLabel.textContent = "颜色";
  colors.appendChild(colorLabel);
  for (const color of HIGHLIGHT_COLORS) colors.appendChild(colorButton("composer-color", color, state.color));
  const actions = document.createElement("div");
  actions.className = "wca-composer-actions";
  if (state.id) {
    const remove = actionButton("delete", "删除");
    remove.dataset.danger = "";
    actions.appendChild(remove);
  }
  actions.appendChild(actionButton("cancel", "取消"));
  const save = actionButton("save", "保存标记");
  save.dataset.primary = "";
  save.disabled = Boolean(state.saving);
  if (state.saving) save.textContent = "保存中…";
  actions.appendChild(save);
  panel.append(head, hint, textarea, colors, actions);
  root.appendChild(panel);
}

function actionButton(action, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.wcaAction = action;
  button.textContent = label;
  return button;
}

function colorButton(action, color, selectedColor) {
  const labels = { yellow: "黄色标记", green: "绿色标记", blue: "蓝色标记" };
  const button = actionButton(action, "");
  button.className = "wca-color";
  button.dataset.color = color;
  button.title = labels[color];
  button.setAttribute("aria-label", labels[color]);
  if (selectedColor) button.setAttribute("aria-pressed", String(normalizeColor(selectedColor) === color));
  return button;
}

function restoreAnnotation(item) {
  if (item.anchor?.kind === "text-range") {
    const geometry = findTextGeometry(item.anchor);
    return geometry.length ? { ...item, geometry, status: "restored" } : { ...item, status: "orphaned" };
  }
  if (item.anchor?.kind === "image") {
    const geometry = findImageGeometry(item.anchor);
    return geometry.length ? { ...item, geometry, status: "restored" } : { ...item, status: "orphaned" };
  }
  if (item.anchor?.kind === "visual-region") {
    const viewport = item.anchor.viewport;
    if (viewport?.width && viewport?.height) {
      const widthDelta = Math.abs(viewport.width - innerWidth) / viewport.width;
      const heightDelta = Math.abs(viewport.height - innerHeight) / viewport.height;
      if (widthDelta > 0.15 || heightDelta > 0.15) return { ...item, status: "orphaned" };
    }
    return { ...item, geometry: [boxToGeometry(item.anchor)], status: "restored" };
  }
  const viewport = item.anchor?.viewport;
  if (viewport?.width && viewport?.height) {
    const widthDelta = Math.abs(viewport.width - innerWidth) / viewport.width;
    const heightDelta = Math.abs(viewport.height - innerHeight) / viewport.height;
    if (widthDelta > 0.15 || heightDelta > 0.15) return { ...item, status: "orphaned" };
  }
  return { ...item, status: "restored" };
}

function annotationGeometry(item) {
  if (item.status === "orphaned") return [];
  if (item.anchor?.kind === "text-range") return findTextGeometry(item.anchor);
  if (item.anchor?.kind === "image") return findImageGeometry(item.anchor);
  const geometry = item.geometry || item.anchor;
  return (Array.isArray(geometry) ? geometry : [geometry]).filter(Boolean);
}

function annotationAtPoint(x, y) {
  return [...annotations].reverse().find((item) => annotationGeometry(item).some((box) => (
    x >= box.x - 3 && x <= box.x + box.width + 3 && y >= box.y - 3 && y <= box.y + box.height + 3
  )));
}

function serializeRange(range, exact) {
  return {
    kind: "text-range", text: exact.trim().slice(0, 4000), exact: exact.slice(0, 4000),
    startPath: nodePath(range.startContainer), startOffset: range.startOffset,
    endPath: nodePath(range.endContainer), endOffset: range.endOffset,
  };
}

function findTextGeometry(anchor) {
  const range = restoreRange(anchor);
  return range ? [...range.getClientRects()].filter(validBox).map(boxToGeometry) : [];
}

function readImage(image) {
  const box = image?.getBoundingClientRect?.();
  if (!box || box.width < 48 || box.height < 32) return null;
  const imageUrl = safeImageUrl(image.currentSrc || image.src);
  if (!imageUrl) return null;
  return {
    geometry: [boxToGeometry(box)],
    imageUrl,
    anchor: {
      kind: "image",
      src: imageUrl,
      alt: String(image.alt || "").slice(0, 300),
      path: nodePath(image),
    },
  };
}

function findImageGeometry(anchor) {
  let image = nodeFromPath(anchor.path);
  if (!(image instanceof HTMLImageElement) || safeImageUrl(image.currentSrc || image.src) !== anchor.src) {
    image = [...document.images].find((candidate) => safeImageUrl(candidate.currentSrc || candidate.src) === anchor.src);
  }
  const box = image?.getBoundingClientRect?.();
  return box && validBox(box) ? [boxToGeometry(box)] : [];
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href.slice(0, 2048) : "";
  } catch {
    return "";
  }
}

async function captureVisualRegion(geometry) {
  const root = document.getElementById(ROOT_ID);
  const visibility = root?.style.visibility || "";
  if (root) root.style.visibility = "hidden";
  try {
    // WebContentsView 在窗口被遮挡或失焦时会节流 rAF；使用任务队列让样式
    // 先提交，又不会让截图保存永远停在“保存中…”。
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return await ipcRenderer.invoke("web-canvas:captureRegion", geometry);
  } finally {
    if (root) root.style.visibility = visibility;
  }
}

function readRegionText(geometry) {
  if (!document.body) return "";
  const lines = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest(`#${ROOT_ID},script,style,noscript,input,textarea,[contenteditable="true"]`)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode()) && lines.join("\n").length < 4000) {
    const value = normalizeText(node.data);
    if (!value || seen.has(value)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const overlaps = [...range.getClientRects()].some((box) => (
      box.right >= geometry.x && box.left <= geometry.x + geometry.width &&
      box.bottom >= geometry.y && box.top <= geometry.y + geometry.height
    ));
    if (overlaps) { seen.add(value); lines.push(value); }
  }
  return lines.join("\n").slice(0, 4000);
}

function restoreRange(anchor) {
  const startNode = nodeFromPath(anchor.startPath);
  const endNode = nodeFromPath(anchor.endPath);
  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, Math.min(Number(anchor.startOffset) || 0, nodeLength(startNode)));
      range.setEnd(endNode, Math.min(Number(anchor.endOffset) || 0, nodeLength(endNode)));
      if (normalizeText(range.toString()) === normalizeText(anchor.exact || anchor.text)) return range;
    } catch {
      // The page changed; fall through to the text-quote anchor.
    }
  }
  return findTextRange(anchor.exact || anchor.text);
}

function findTextRange(text) {
  const target = String(text || "");
  if (!target || !document.body) return null;
  const nodes = textNodes();
  const fullText = nodes.map((entry) => entry.node.data).join("");
  let index = fullText.indexOf(target);
  let matchedText = target;
  if (index < 0) {
    const trimmed = target.trim();
    index = fullText.indexOf(trimmed);
    matchedText = trimmed;
  }
  if (index < 0 || !matchedText) return null;
  const endIndex = index + matchedText.length;
  let cursor = 0;
  let startPoint = null;
  let endPoint = null;
  for (const { node } of nodes) {
    const next = cursor + node.data.length;
    if (!startPoint && index >= cursor && index <= next) startPoint = { node, offset: index - cursor };
    if (!endPoint && endIndex >= cursor && endIndex <= next) {
      endPoint = { node, offset: endIndex - cursor };
      break;
    }
    cursor = next;
  }
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function textNodes() {
  const result = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest(`#${ROOT_ID},script,style,noscript,input,textarea,[contenteditable="true"]`)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) result.push({ node });
  return result;
}

function nodePath(node) {
  if (!node || !document.body?.contains(node)) return undefined;
  const path = [];
  let current = node;
  while (current && current !== document.body) {
    const parent = current.parentNode;
    if (!parent) return undefined;
    path.unshift([...parent.childNodes].indexOf(current));
    current = parent;
  }
  return current === document.body ? path : undefined;
}

function nodeFromPath(path) {
  if (!Array.isArray(path) || !document.body) return null;
  let node = document.body;
  for (const index of path) {
    node = node.childNodes?.[index];
    if (!node) return null;
  }
  return node;
}

function renderStroke(root, id, type, geometry) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("wca-stroke");
  svg.dataset.wcaId = id;
  if (type === "arrow") {
    const path = document.createElementNS(ns, "path");
    const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = geometry || {};
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const size = 10;
    path.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y2} L ${x2 - size * Math.cos(angle - .55)} ${y2 - size * Math.sin(angle - .55)} M ${x2} ${y2} L ${x2 - size * Math.cos(angle + .55)} ${y2 - size * Math.sin(angle + .55)}`);
    svg.appendChild(path);
  } else {
    const polyline = document.createElementNS(ns, "polyline");
    polyline.setAttribute("points", (geometry?.points || []).map((point) => `${point.x},${point.y}`).join(" "));
    svg.appendChild(polyline);
  }
  root.appendChild(svg);
  return svg;
}

function renderBox(root, id, type, geometry) {
  const node = document.createElement("div");
  node.className = `wca-shape ${String(type).split(/\s+/).map((name) => `wca-${name}`).join(" ")}`;
  node.dataset.wcaId = id;
  Object.assign(node.style, {
    left: `${Number(geometry?.x || 0)}px`, top: `${Number(geometry?.y || 0)}px`,
    width: `${Math.max(2, Number(geometry?.width || 2))}px`, height: `${Math.max(2, Number(geometry?.height || 2))}px`,
  });
  root.appendChild(node);
  return node;
}

function reportSelection() {
  const selection = window.getSelection();
  ipcRenderer.send("web-canvas:selection", selection && !selection.isCollapsed ? selection.toString().slice(0, 4000) : "");
}

function unionGeometry(boxes) {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rect(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; }
function validBox(box) { return box.width > 1 && box.height > 1; }
function boxToGeometry(box) { return { x: box.x, y: box.y, width: box.width, height: box.height }; }
function nodeLength(node) { return node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length; }
function normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function normalizeColor(value) { return HIGHLIGHT_COLORS.has(value) ? value : DEFAULT_HIGHLIGHT_COLOR; }
function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
function cssEscape(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
