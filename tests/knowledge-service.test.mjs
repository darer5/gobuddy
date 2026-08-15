import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GoBuddyDatabase } from "../electron/main/database.mjs";
import { KnowledgeService } from "../electron/main/knowledge-service.mjs";

test("knowledge service searches clipboard and screenshot metadata", async () => {
  const { knowledge } = await createKnowledgeFixture();

  const links = knowledge.search({ query: "example", type: "link" });
  assert.equal(links.length, 1);
  assert.equal(links[0].type, "link");

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

test("knowledge service lists recent clipboard and screenshots with a limit", async () => {
  const { db, knowledge } = await createKnowledgeFixture();
  for (let index = 3; index <= 35; index += 1) {
    db.addClipboardItem(item(String(index), "text", `recent ${index}`), 100);
  }

  const recent = knowledge.listRecent({ limit: 30 });
  assert.equal(recent.length, 30);
  assert.ok(new Date(recent[0].createdAt) >= new Date(recent[1].createdAt));
  assert.ok(recent.some((entry) => entry.sourceType === "clipboard"));
});

test("knowledge service exposes sensitive metadata for prompt redaction", async () => {
  const { knowledge } = await createKnowledgeFixture();
  const [secret] = knowledge.search({ query: "api_key" });

  assert.equal(secret.sensitive, true);
});

async function createKnowledgeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-knowledge-"));
  const db = new GoBuddyDatabase(dir);
  await db.initialize();
  db.addClipboardItem(item("1", "text", "alpha note"), 10);
  db.addClipboardItem(item("2", "link", "https://example.com"), 10);
  db.addClipboardItem({ ...item("99", "text", "api_key=secret-value"), sensitive: true }, 10);
  db.addScreenshot({
    id: "shot-1",
    filePath: path.join(dir, "screenshot.png"),
    createdAt: new Date().toISOString(),
    width: 100,
    height: 80,
    copiedToClipboard: true,
    message: "screenshot saved",
  });
  const knowledge = new KnowledgeService({
    database: db,
    clipboardMonitor: { restore: () => ({ ok: true }) },
    shellOpener: { openPath: async () => "" },
  });
  return { db, knowledge };
}

function item(id, type, content) {
  return {
    id,
    type,
    title: content,
    content,
    contentHash: id,
    createdAt: new Date(Date.now() + Number(id)).toISOString(),
    favorite: false,
    sensitive: false,
    metadata: {},
  };
}
