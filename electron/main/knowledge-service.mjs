import path from "node:path";

const allowedPatchKeys = new Set(["note", "tags"]);
// Screenshot metadata lives in SQLite while notes/tags live in the
// knowledge_overrides table. The database layer only matches file_path and
// message, so pre-filtering in SQL would silently miss note/tag searches.
// The catalog is small enough to filter in memory.
const MAX_SCAN_ITEMS = 10000;

export class KnowledgeService {
  constructor({ database, shellOpener }) {
    this.database = database;
    this.shellOpener = shellOpener;
    this.pendingActions = new Map();
  }

  search({ query = "", type = "all", limit = 20 } = {}) {
    const normalizedType = normalizeKnowledgeType(type);
    const items = [];

    if (normalizedType === "all" || normalizedType === "screenshot") {
      items.push(...this.database.listScreenshots({ query: "", limit: MAX_SCAN_ITEMS }).map((item) => (
        this.enrich(screenshotToKnowledge(item))
      )));
    }

    return items
      .filter((item) => matchesKnowledge(item, query))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  listRecent({ limit = 30 } = {}) {
    return this.search({ query: "", type: "all", limit });
  }

  get(id) {
    const screenshot = this.database.findScreenshot(id);
    if (screenshot) {
      return this.enrich(screenshotToKnowledge(screenshot));
    }

    return null;
  }

  update(id, patch) {
    const item = this.get(id);
    if (!item) {
      throw new Error("未找到知识条目。");
    }

    const safePatch = sanitizePatch(patch);
    this.database.updateKnowledgeOverride(id, safePatch);
    return this.get(id);
  }

  proposeUpdate(id, patch, reason = "") {
    const item = this.get(id);
    if (!item) {
      throw new Error("未找到知识条目。");
    }

    const action = {
      id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "knowledge.update",
      itemId: id,
      patch: sanitizePatch(patch),
      reason,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.pendingActions.set(action.id, action);
    return action;
  }

  confirmAction(actionId, approved) {
    const action = this.pendingActions.get(actionId);
    if (!action) {
      return { ok: false, message: "未找到待确认操作。" };
    }

    this.pendingActions.delete(actionId);
    if (!approved) {
      return { ok: true, approved: false, action: { ...action, status: "rejected" } };
    }

    const item = this.update(action.itemId, action.patch);
    return { ok: true, approved: true, action: { ...action, status: "approved" }, item };
  }

  async open(id) {
    const item = this.get(id);
    if (!item || !item.filePath) {
      return { ok: false, message: "该知识条目没有可打开的本地文件。" };
    }

    // shell.openPath resolves with an error message string when it fails,
    // and an empty string on success — never treat a failure as success.
    const errorMessage = await this.shellOpener.openPath(item.filePath);
    if (errorMessage) {
      return { ok: false, message: errorMessage };
    }
    return { ok: true, item };
  }

  enrich(item) {
    const override = this.database.getKnowledgeOverride(item.id);
    return {
      ...item,
      note: override.note,
      tags: override.tags,
      searchableText: [
        item.title,
        item.content,
        item.filePath,
        override.note,
        ...(override.tags ?? []),
      ].filter(Boolean).join("\n"),
    };
  }
}

export function screenshotToKnowledge(item) {
  return {
    id: item.id,
    sourceType: "screenshot",
    type: "screenshot",
    title: item.title || path.basename(item.filePath),
    content: `截图元数据：${item.width}x${item.height}，${item.message}`,
    filePath: item.filePath,
    createdAt: item.createdAt,
    metadata: {
      width: item.width,
      height: item.height,
      copiedToClipboard: item.copiedToClipboard,
    },
  };
}

export function sanitizePatch(patch = {}) {
  const output = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedPatchKeys.has(key)) continue;
    if (key === "note" && typeof value === "string") {
      output.note = value.slice(0, 2000);
    }
    if (key === "tags" && Array.isArray(value)) {
      output.tags = value.filter((tag) => typeof tag === "string").map((tag) => tag.slice(0, 40)).slice(0, 20);
    }
  }
  return output;
}

function normalizeKnowledgeType(type) {
  if (type === "screenshot") return "screenshot";
  return "all";
}

function matchesKnowledge(item, query) {
  if (!query) return true;
  return item.searchableText.toLowerCase().includes(query.toLowerCase());
}
