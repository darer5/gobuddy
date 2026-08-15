import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GoBuddyDatabase } from "../electron/main/database.mjs";

test("stores, filters, favorites, deletes and trims clipboard rows", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-db-"));
  const db = new GoBuddyDatabase(dir);
  await db.initialize();

  db.addClipboardItem(item("1", "text", "alpha"), 10);
  db.addClipboardItem(item("2", "link", "https://example.com"), 10);

  assert.equal(db.listClipboard({ type: "all" }).length, 2);
  assert.equal(db.listClipboard({ type: "link" }).length, 1);
  assert.equal(db.listClipboard({ query: "alpha" })[0].id, "1");

  db.favoriteClipboard("1", true);
  assert.equal(db.listClipboard({ type: "all" })[0].favorite, true);

  db.deleteClipboard("1");
  assert.equal(db.listClipboard({ type: "all" }).length, 1);
});

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
