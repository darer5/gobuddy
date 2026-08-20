import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AnnotationStore,
  canonicalizeWebUrl,
  createWebContext,
  normalizeWebUrl,
} from "../electron/main/web-canvas-core.mjs";

test("normalizes and validates Web Canvas URLs", () => {
  assert.equal(normalizeWebUrl("example.com"), "https://example.com/");
  assert.throws(() => normalizeWebUrl("file:///tmp/a"), /HTTP\/HTTPS/);
  assert.equal(canonicalizeWebUrl("https://example.com/a/?utm_source=x&b=2#part"), "https://example.com/a?b=2");
});

test("Xueqiu adapter resolves entity and keeps previous entity", () => {
  const first = createWebContext({ url: "https://xueqiu.com/S/SH600519", title: "贵州茅台 SH600519" }, null, 1);
  const second = createWebContext({ url: "https://xueqiu.com/S/SZ000858", title: "五粮液 SZ000858" }, first, 2);
  assert.equal(first.entity.symbol, "SH600519");
  assert.equal(second.entity.symbol, "SZ000858");
  assert.equal(second.previousEntity.symbol, "SH600519");
  assert.equal(second.pageIdentity, "xueqiu:stock:SZ000858");
});

test("generic context limits visible text and masks password-like values", () => {
  const context = createWebContext({
    url: "https://example.com/article/1",
    title: "Reading",
    visibleText: `password: secret\n${"x".repeat(13000)}`,
  });
  assert.match(context.visibleText, /\[已隐藏\]/);
  assert.ok(context.visibleText.length <= 12000);
  assert.equal(context.adapter, "generic-reading");
});

test("annotation store persists and deletes by id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-canvas-"));
  const file = path.join(dir, "annotations.json");
  const store = new AnnotationStore(file);
  store.upsert({ id: "a1", pageIdentity: "p1", type: "rectangle" });
  assert.equal(new AnnotationStore(file).list("p1").length, 1);
  assert.equal(store.remove("a1"), true);
  assert.equal(new AnnotationStore(file).list().length, 0);
});
