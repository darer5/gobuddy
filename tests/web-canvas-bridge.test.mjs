import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WebCanvasController } from "../electron/main/web-canvas.mjs";

test("Web Canvas bridge is loopback-only and requires its bearer token", async () => {
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
