import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WebCanvasController } from "../electron/main/web-canvas.mjs";

test("PageLens bridge is loopback-only and requires its bearer token", async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "web-canvas-bridge-"));
  const controller = new WebCanvasController({ userDataPath });
  controller.currentContext = { url: "https://example.com", title: "Example" };
  const env = await controller.startBridge();
  try {
    const denied = await fetch(`${env.GOBUDDY_WEB_CANVAS_BRIDGE_URL}/context`);
    assert.equal(denied.status, 401);

    const response = await fetch(`${env.GOBUDDY_WEB_CANVAS_BRIDGE_URL}/context`, {
      headers: { authorization: `Bearer ${env.GOBUDDY_WEB_CANVAS_BRIDGE_TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, "Example");
    assert.match(env.GOBUDDY_WEB_CANVAS_BRIDGE_URL, /^http:\/\/127\.0\.0\.1:/);
  } finally {
    controller.destroy();
  }
});

test("PageLens hides its native page while a host dialog is open and restores it afterwards", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "web-canvas-layer-"));
  const visibility = [];
  const controller = new WebCanvasController({ userDataPath });
  controller.view = { setVisible: (value) => visibility.push(value) };
  controller.visible = true;

  assert.deepEqual(controller.setSuspended(true), { ok: true, suspended: true });
  assert.deepEqual(controller.setSuspended(false), { ok: true, suspended: false });
  controller.visible = false;
  controller.setSuspended(false);

  assert.deepEqual(visibility, [false, true, false]);
});

test("PageLens remembers reading mode and forwards it to the native page", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "web-canvas-reading-"));
  const sent = [];
  const controller = new WebCanvasController({ userDataPath });
  controller.view = { webContents: { send: (...args) => sent.push(args) } };

  assert.deepEqual(controller.setReadingMode(false), { ok: true, readingMode: false });
  assert.equal(controller.getState().readingMode, false);
  assert.deepEqual(sent, [["web-canvas:reading-mode", false]]);
});

test("PageLens crops, persists, reads and cleans up a visual-region capture", async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "web-canvas-region-"));
  let capturedGeometry;
  const png = Buffer.from("test-png");
  const image = {
    getSize: () => ({ width: 320, height: 180 }),
    resize: () => image,
    toPNG: () => png,
  };
  const controller = new WebCanvasController({ userDataPath });
  controller.currentContext = {
    pageIdentity: "web:https://example.com/market",
    canonicalUrl: "https://example.com/market",
    site: "example.com",
  };
  controller.view = {
    getBounds: () => ({ width: 680, height: 800 }),
    webContents: {
      capturePage: async (geometry) => { capturedGeometry = geometry; return image; },
      send() {},
    },
  };

  const capture = await controller.captureRegion({ x: -20, y: 40, width: 900, height: 200 });
  assert.deepEqual(capturedGeometry, { x: 0, y: 40, width: 680, height: 200 });
  controller.saveAnnotation({ id: "market-1", type: "question", capturePath: capture.filePath });
  const result = controller.readAnnotationCapture("market-1");
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
  assert.equal(fs.existsSync(capture.filePath), true);

  controller.deleteAnnotation("market-1");
  assert.equal(fs.existsSync(capture.filePath), false);
});
