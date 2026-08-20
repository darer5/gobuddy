const { ipcRenderer } = require("electron");

const ROOT_ID = "__gobuddy_web_canvas_annotations__";
const STYLE_ID = "__gobuddy_web_canvas_styles__";
let tool = "select";
let start = null;
let draft = null;
let annotations = [];

window.addEventListener("DOMContentLoaded", mount, { once: true });
ipcRenderer.on("web-canvas:set-tool", (_event, value) => { tool = value; syncMode(); });
ipcRenderer.on("web-canvas:restore", (_event, items) => {
  annotations = (Array.isArray(items) ? items : []).map(restoreAnnotation);
  for (const item of annotations) ipcRenderer.send("web-canvas:annotation-status", { id: item.id, status: item.status });
  render();
});
ipcRenderer.on("web-canvas:delete", (_event, id) => { annotations = annotations.filter((item) => item.id !== id); render(); });
ipcRenderer.on("web-canvas:undo", () => {
  const item = annotations.pop();
  if (item) ipcRenderer.send("web-canvas:annotation-delete", item.id);
  render();
});
ipcRenderer.on("web-canvas:focus", (_event, id) => {
  const node = document.querySelector(`[data-wca-id="${cssEscape(id)}"]`);
  if (!node) return;
  node.animate([{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }], { duration: 900 });
});

function mount() {
  if (!document.documentElement || document.getElementById(ROOT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden}
    html[data-wca-mode="draw"] #${ROOT_ID}{pointer-events:auto;cursor:crosshair}
    .wca-shape{position:absolute;box-sizing:border-box;pointer-events:none}
    .wca-rectangle{border:2px solid #ffb020;background:rgba(255,176,32,.10);border-radius:4px}
    .wca-highlight{background:rgba(255,215,64,.36);border-bottom:2px solid #f4b400}
    .wca-question{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#e64d3d;color:white;font:700 16px system-ui;box-shadow:0 3px 10px #0004}
    .wca-text{max-width:260px;padding:7px 9px;border-radius:7px;background:#fff8d6;color:#342d16;border:1px solid #e4c85c;font:12px/1.4 system-ui;box-shadow:0 3px 10px #0003}
    .wca-stroke{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
    .wca-stroke path,.wca-stroke polyline{fill:none;stroke:#ff6b35;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .wca-active{outline:3px solid #5b8cff!important;outline-offset:2px}
  `;
  document.documentElement.appendChild(style);
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  document.documentElement.appendChild(root);
  document.addEventListener("selectionchange", reportSelection);
  syncMode();
  render();
}

function syncMode() {
  if (!document.documentElement) return;
  if (["rectangle", "arrow", "freehand", "question", "text"].includes(tool)) document.documentElement.dataset.wcaMode = "draw";
  else delete document.documentElement.dataset.wcaMode;
  if (tool === "highlight") window.setTimeout(captureHighlight, 30);
}

function onPointerDown(event) {
  if (!["rectangle", "arrow", "freehand", "question", "text"].includes(tool) || event.button !== 0) return;
  event.preventDefault();
  start = { x: event.clientX, y: event.clientY };
  draft = tool === "freehand"
    ? { points: [{ x: event.clientX, y: event.clientY }] }
    : tool === "arrow"
      ? { x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY }
      : { x: event.clientX, y: event.clientY, width: 1, height: 1 };
  render();
}

function onPointerMove(event) {
  if (!start) return;
  if (tool === "rectangle") draft = rect(start, { x: event.clientX, y: event.clientY });
  if (tool === "arrow") draft = { x1: start.x, y1: start.y, x2: event.clientX, y2: event.clientY };
  if (tool === "freehand") draft = { points: [...(draft?.points || []), { x: event.clientX, y: event.clientY }] };
  render();
}

function onPointerUp(event) {
  if (!start) return;
  event.preventDefault();
  if (tool === "rectangle") {
    const geometry = rect(start, { x: event.clientX, y: event.clientY });
    if (geometry.width >= 8 && geometry.height >= 8) create("rectangle", geometry);
  } else if (tool === "arrow") {
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) create("arrow", { x1: start.x, y1: start.y, x2: event.clientX, y2: event.clientY });
  } else if (tool === "freehand") {
    if ((draft?.points?.length || 0) >= 2) create("freehand", draft);
  } else if (tool === "question") {
    const question = window.prompt("你想问 AI 什么？", "请分析这里");
    if (question !== null) create("question", { x: event.clientX - 14, y: event.clientY - 14, width: 28, height: 28 }, { question });
  } else if (tool === "text") {
    const note = window.prompt("输入标注内容", "");
    if (note) create("text", { x: event.clientX, y: event.clientY, width: 220, height: 44 }, { note });
  }
  start = null;
  draft = null;
  render();
}

function captureHighlight() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
  const range = selection.getRangeAt(0);
  const boxes = [...range.getClientRects()].filter((box) => box.width > 1 && box.height > 1).map(boxToGeometry);
  if (!boxes.length) return;
  create("highlight", boxes[0], {
    selectedText: selection.toString().trim().slice(0, 4000),
    geometry: boxes,
    anchor: { kind: "text-range", text: selection.toString().trim().slice(0, 4000) },
  });
  selection.removeAllRanges();
}

function create(type, geometry, extra = {}) {
  const annotation = {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    geometry: extra.geometry || geometry,
    anchor: extra.anchor || { kind: "viewport-region", ...geometry, viewport: { width: innerWidth, height: innerHeight } },
    note: extra.note,
    question: extra.question,
    selectedText: extra.selectedText,
    createdAt: Date.now(),
  };
  annotations.push(annotation);
  ipcRenderer.send("web-canvas:annotation-create", annotation);
  render();
}

function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.replaceChildren();
  for (const item of annotations) renderAnnotation(root, item);
  if (draft && tool === "rectangle") renderBox(root, "draft", "rectangle", draft);
  if (draft && ["arrow", "freehand"].includes(tool)) renderStroke(root, "draft", tool, draft);
}

function renderAnnotation(root, item) {
  if (item.status === "orphaned") return;
  if (item.type === "arrow" || item.type === "freehand") {
    renderStroke(root, item.id, item.type, item.geometry);
    return;
  }
  const geometries = Array.isArray(item.geometry) ? item.geometry : [item.geometry || item.anchor];
  for (const geometry of geometries) {
    const node = renderBox(root, item.id, item.type, geometry);
    if (item.type === "question") node.textContent = "?";
    if (item.type === "text") node.textContent = item.note || "笔记";
  }
}

function restoreAnnotation(item) {
  if (item.anchor?.kind === "text-range" && item.selectedText) {
    const geometry = findTextGeometry(item.selectedText);
    return geometry.length ? { ...item, geometry, status: "restored" } : { ...item, status: "orphaned" };
  }
  const viewport = item.anchor?.viewport;
  if (viewport?.width && viewport?.height) {
    const widthDelta = Math.abs(viewport.width - innerWidth) / viewport.width;
    const heightDelta = Math.abs(viewport.height - innerHeight) / viewport.height;
    if (widthDelta > 0.15 || heightDelta > 0.15) return { ...item, status: "orphaned" };
  }
  return { ...item, status: "restored" };
}

function findTextGeometry(text) {
  const target = String(text).trim();
  if (!target || !document.body) return [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest(`#${ROOT_ID},script,style,input,textarea`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) {
    const index = node.data.indexOf(target);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + target.length);
    return [...range.getClientRects()].filter((box) => box.width > 1 && box.height > 1).map(boxToGeometry);
  }
  return [];
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
  node.className = `wca-shape wca-${type}`;
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
  if (tool === "highlight") window.setTimeout(captureHighlight, 0);
}

function rect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
function boxToGeometry(box) { return { x: box.x, y: box.y, width: box.width, height: box.height }; }
function cssEscape(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
