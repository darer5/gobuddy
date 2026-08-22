import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panelSource = fs.readFileSync(path.join(projectRoot, "plugins/dsh-web-canvas/lib/client.js"), "utf8");
const annotationSource = fs.readFileSync(path.join(projectRoot, "electron/preload/web-canvas.mjs"), "utf8");

test("PageLens uses an uncontrolled address field so live context updates cannot erase typing", () => {
  assert.match(panelSource, /const DEFAULT_URL = "https:\/\/www\.xueqiu\.com\/"/);
  assert.match(panelSource, /ref: urlRef/);
  assert.match(panelSource, /defaultValue: DEFAULT_URL/);
  assert.match(panelSource, /editingUrl\.current/);
  assert.match(panelSource, /urlDirty\.current/);
  assert.match(panelSource, /onBeforeInput: \(event\) => event\.stopPropagation\(\)/);
  assert.doesNotMatch(panelSource, /value: url/);
});

test("PageLens suspends the native page when a host dialog covers it", () => {
  assert.match(panelSource, /hasBlockingDialog/);
  assert.match(panelSource, /api\?\.setSuspended\(next\)/);
  assert.match(panelSource, /control\?\.textContent\?\.trim\(\) === "设置"/);
});

test("PageLens waits for pointer-up before offering a question for multi-rect text", () => {
  assert.match(annotationSource, /document\.addEventListener\("pointerup", onDocumentPointerUp, true\)/);
  assert.doesNotMatch(annotationSource, /selectionchange[^\n]*captureHighlight/);
  assert.match(annotationSource, /\[\.\.\.range\.getClientRects\(\)\]/);
  assert.match(annotationSource, /geometry, anchor: serializeRange\(range, exact\)/);
});

test("PageLens offers three direct highlight colors before the question action", () => {
  assert.match(annotationSource, /for \(const color of HIGHLIGHT_COLORS\) menu\.appendChild\(colorButton\("color", color\)\)/);
  assert.match(annotationSource, /actionButton\("question", "提问"\)/);
  assert.match(annotationSource, /黄色标记/);
  assert.match(annotationSource, /绿色标记/);
  assert.match(annotationSource, /蓝色标记/);
  assert.doesNotMatch(annotationSource, /window\.prompt\(/);
});

test("PageLens saves an empty question as a marker-only highlight", () => {
  assert.doesNotMatch(annotationSource, /if \(!composer \|\| !value\) return/);
  assert.match(annotationSource, /question: value \|\| undefined/);
  assert.match(annotationSource, /if \(!String\(item\.question \|\| ""\)\.trim\(\)\) return/);
  assert.match(annotationSource, /问题可留空；留空时仅保留标记区域/);
});

test("PageLens hit-tests existing annotations without blocking new text selections", () => {
  assert.match(annotationSource, /document\.addEventListener\("click", onDocumentClick, true\)/);
  assert.match(annotationSource, /function annotationAtPoint\(/);
  assert.match(annotationSource, /openAnnotation\(annotation\)/);
  assert.match(annotationSource, /actionButton\("delete", "删除"\)/);
  assert.match(annotationSource, /#\$\{ROOT_ID\}.*pointer-events:none/);
});

test("PageLens anchors image questions by URL and includes the URL in chat context", () => {
  assert.match(annotationSource, /function readImage\(/);
  assert.match(annotationSource, /kind: "image"/);
  assert.match(annotationSource, /safeImageUrl/);
  assert.match(panelSource, /标记图片：\$\{imageUrl\}/);
});

test("PageLens sidebar icon uses the 24px Fluent visual language", () => {
  assert.match(panelSource, /TargetEdit24Regular/);
  assert.match(panelSource, /\.wc-entry-icon svg\{width:24px;height:24px/);
  assert.match(panelSource, /\[data-sidebar-collapsed="true"\].*data-dsh-web-canvas-entry.*data-dsh-taskboard-entry.*justify-content:center/);
  assert.doesNotMatch(panelSource, /data-dsh-weread-entry/);
  assert.match(panelSource, /\[data-sidebar-collapsed="true"\].*>span:last-child\{display:none/);
  assert.doesNotMatch(panelSource, /wc-entry-icon">◎/);
});

test("PageLens and task board use one exclusive-panel protocol", () => {
  assert.match(panelSource, /CustomEvent\("dsh-panel-activate", \{ detail: "webcanvas" \}\)/);
  assert.match(panelSource, /event\.detail !== "webcanvas" && open/);
});

test("PageLens has a single focus bar and sends a readable compact context", () => {
  assert.match(panelSource, /className: "wc-focusbar"/);
  assert.doesNotMatch(panelSource, /className: "wc-tools"/);
  assert.match(panelSource, /标题：\$\{title\}/);
  assert.match(panelSource, /选中内容：/);
  assert.doesNotMatch(panelSource, /JSON\.stringify\(bundle/);
  assert.doesNotMatch(panelSource, /previousEntity/);
  assert.doesNotMatch(panelSource, /annotations\.at\(-1\)/);
  assert.match(panelSource, /共标记 \$\{regions\.length\} 个区域/);
  assert.match(panelSource, /for \(const \[index, annotation\] of captures\.entries\(\)\)/);
  assert.match(panelSource, /attachImagesToComposer\(capturePayloads\)/);
  assert.match(panelSource, /for \(const \[index, capture\] of captures\.entries\(\)\)/);
});

test("PageLens reading mode applies responsive article widths without a new reader dependency", () => {
  assert.match(panelSource, /api\.setReadingMode\(next\)/);
  assert.match(annotationSource, /data-wca-reading/);
  assert.match(annotationSource, /\.home__col--rt\{display:none!important\}/);
  assert.match(annotationSource, /width:min\(720px,calc\(100vw - 32px\)\)/);
  assert.match(annotationSource, /#UCAP-CONTENT/);
  assert.match(annotationSource, /\.article\.oneColumn\{padding-left:clamp\(16px,4vw,40px\)!important/);
  assert.match(annotationSource, /:is\(#UCAP-CONTENT,\.pages_content\)\{width:100%!important/);
  assert.match(annotationSource, /data-wca-article/);
  assert.match(annotationSource, /findReadingRoot\(\)/);
  assert.match(annotationSource, /data-wca-reader-root/);
  assert.match(annotationSource, /data-wca-reader-hidden/);
});

test("PageLens annotation composer can be dragged without losing its draft", () => {
  assert.match(annotationSource, /data-wca-drag-handle/);
  assert.match(annotationSource, /composerDrag = \{ pointerId:/);
  assert.match(annotationSource, /composer\.position = \{/);
  assert.match(annotationSource, /cursor:grab/);
});

test("PageLens captures visual regions and adds them as native image context", () => {
  assert.match(annotationSource, /"visual-region"/);
  assert.match(annotationSource, /readRegionText\(geometry\)/);
  assert.match(annotationSource, /captureVisualRegion/);
  assert.match(annotationSource, /window\.setTimeout\(resolve, 0\)/);
  assert.match(panelSource, /api\.readAnnotationCapture\(annotation\.id\)/);
  assert.match(panelSource, /new DataTransfer\(\)/);
  assert.match(panelSource, /new DragEvent\("drop"/);
  assert.match(panelSource, /行情截图已作为图片附件加入本次对话/);
});

test("PageLens throttles drawing, captures the pointer and keeps region mode reusable", () => {
  assert.match(annotationSource, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(annotationSource, /releasePointerCapture\?\.\(event\.pointerId\)/);
  assert.match(annotationSource, /root\.addEventListener\("pointercancel", onPointerCancel\)/);
  assert.match(annotationSource, /if \(tool === "region"\) draft = rect/);
  assert.match(annotationSource, /if \(draft && start\) renderDraft\(root\)/);
  assert.match(annotationSource, /scheduleRender\(\);/);
});

test("PageLens keeps browser controls at the bottom", () => {
  assert.match(panelSource, /grid-template-rows:minmax\(0,1fr\) 58px/);
  assert.match(panelSource, /\.wc-focusbar\{grid-row:2/);
  assert.match(panelSource, /\.wc-stage\{grid-row:1/);
  assert.match(panelSource, /框选行情组件并生成截图/);
});
