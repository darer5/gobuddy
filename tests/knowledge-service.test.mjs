import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GoBuddyDatabase } from "../electron/main/database.mjs";
import { KnowledgeService } from "../electron/main/knowledge-service.mjs";

test("knowledge service searches screenshot metadata", async () => {
  const { knowledge } = await createKnowledgeFixture();

  const screenshots = knowledge.search({ query: "screenshot", type: "screenshot" });
  assert.equal(screenshots.length, 1);
  assert.equal(screenshots[0].type, "screenshot");
});

test("knowledge write actions require confirmation", async () => {
  const { knowledge } = await createKnowledgeFixture();
  const [item] = knowledge.search({ query: "alpha" });

  const action = knowledge.proposeUpdate(item.id, { tags: ["项目资料"], note: "重要片段" });
  assert.equal(action.status, "pending");
  assert.equal(knowledge.get(item.id).tags.length, 0);

  const result = knowledge.confirmAction(action.id, true);
  assert.equal(result.ok, true);
  assert.deepEqual(knowledge.get(item.id).tags, ["项目资料"]);
});

test("knowledge service lists recent screenshots with a limit", async () => {
  const { db, knowledge } = await createKnowledgeFixture();
  for (let index = 3; index <= 35; index += 1) {
    db.addScreenshot({
      id: String(index),
      filePath: path.join(dbPath(index), "screenshot.png"),
      createdAt: new Date(Date.now() + index).toISOString(),
      width: 100,
      height: 80,
      copiedToClipboard: true,
      message: `recent ${index}`,
    });
  }

  const recent = knowledge.listRecent({ limit: 30 });
  assert.equal(recent.length, 30);
  assert.ok(new Date(recent[0].createdAt) >= new Date(recent[1].createdAt));
  assert.ok(recent.every((entry) => entry.sourceType === "screenshot"));
});

async function createKnowledgeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-knowledge-"));
  const db = new GoBuddyDatabase(dir);
  await db.initialize();
  db.addScreenshot({
    id: "1",
    filePath: path.join(dir, "shot-alpha.png"),
    createdAt: new Date().toISOString(),
    width: 1200,
    height: 720,
    copiedToClipboard: true,
    message: "alpha screenshot",
  });
  const knowledge = new KnowledgeService({
    database: db,
    shellOpener: { openPath: async () => "" },
  });
  return { db, knowledge };
}

function dbPath(index) {
  return path.join("C:", "mock", String(index));
}
