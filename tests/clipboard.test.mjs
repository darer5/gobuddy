import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyClipboardText } from "../electron/main/clipboard.mjs";

test("classifies links and plain text", () => {
  assert.equal(classifyClipboardText("https://github.com/openai/codex"), "link");
  assert.equal(classifyClipboardText("const value = 1;"), "text");
});
