import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ChatAgentService } from "../electron/main/chat-agent.mjs";
import { GoBuddyDatabase } from "../electron/main/database.mjs";
import { KnowledgeService } from "../electron/main/knowledge-service.mjs";

test("chat agent stores messages and returns knowledge references", async () => {
  const { chat } = await createChatFixture();

  const result = await chat.sendMessage({ text: "帮我找最近的截图" });

  assert.ok(result.session.id);
  assert.equal(result.userMessage.role, "user");
  assert.equal(result.assistantMessage.role, "assistant");
  assert.equal(result.assistantMessage.references[0].type, "screenshot");
});

test("chat agent creates pending update proposals instead of direct writes", async () => {
  const { chat, knowledge } = await createChatFixture();

  const result = await chat.sendMessage({ text: "把这张截图标记为 项目资料" });

  assert.ok(result.assistantMessage.toolEvents.some((event) => event.name === "gobuddy.propose_update_knowledge_item"));
  const item = knowledge.search({ query: "alpha" })[0];
  assert.equal(item.tags.length, 0);
});

async function createChatFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-chat-"));
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
  db.addScreenshot({
    id: "2",
    filePath: path.join(dir, "shot-beta.png"),
    createdAt: new Date(Date.now() + 1000).toISOString(),
    width: 800,
    height: 600,
    copiedToClipboard: true,
    message: "beta screenshot",
  });
  const knowledge = new KnowledgeService({
    database: db,
    shellOpener: { openPath: async () => "" },
  });
  const harnessRuntime = {
    getStatus: () => ({ state: "available", message: "test runtime" }),
    stop: () => ({ state: "available" }),
  };
  const chat = new ChatAgentService({
    database: db,
    knowledgeService: knowledge,
    harnessRuntime,
    sendEvent: () => {},
  });
  return { db, knowledge, chat };
}
