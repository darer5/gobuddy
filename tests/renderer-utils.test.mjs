import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("renderer converts Windows paths with spaces and Chinese characters to file URLs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gobuddy-renderer-"));
  const sourcePath = path.join(tempDir, "main.mjs");
  const text = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "main.jsx"), "utf8");
  const match = text.match(/export function filePathToUrl[\s\S]*?\n}\n/);
  fs.writeFileSync(sourcePath, match[0], "utf8");
  const { filePathToUrl } = await import(`file:///${sourcePath.replaceAll("\\", "/")}`);

  assert.equal(
    filePathToUrl("C:\\Users\\yuhui\\图片\\hello world#1.png"),
    "file:///C:/Users/yuhui/%E5%9B%BE%E7%89%87/hello%20world%231.png",
  );
});
