import assert from "node:assert/strict";
import { test } from "node:test";
import { apply } from "../plugins/dsh-web-canvas/lib/index.js";

test("PageLens tools satisfy Harness/model naming and output contracts", () => {
  const tools = [];
  apply({ tools: { register: (tool) => tools.push(tool) } });

  assert.equal(tools.length, 6);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-zA-Z0-9_-]+$/);
    assert.equal(typeof tool.output?.render, "function");
    assert.equal(typeof tool.output?.presentationMeta, "function");
  }
});
