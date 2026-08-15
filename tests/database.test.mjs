import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GoBuddyDatabase } from "../electron/main/database.mjs";

test("stores and lists screenshot rows", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-db-"));
  const db = new GoBuddyDatabase(dir);
  await db.initialize();

  db.addScreenshot(screenshot("1", "shot-alpha.png", "alpha screenshot"));
  db.addScreenshot(screenshot("2", "shot-beta.png", "beta screenshot"));

  assert.equal(db.listScreenshots().length, 2);
  assert.equal(db.listScreenshots({ query: "alpha" })[0].id, "1");
  assert.equal(db.findScreenshot("2").title, "shot-beta.png");
});

function screenshot(id, fileName, message) {
  return {
    id,
    filePath: path.join("C:", "mock", fileName),
    createdAt: new Date(Date.now() + Number(id)).toISOString(),
    width: 1200,
    height: 720,
    copiedToClipboard: true,
    message,
  };
}
