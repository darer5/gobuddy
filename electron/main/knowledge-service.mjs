import path from "node:path";

const allowedPatchKeys = new Set(["note", "tags"]);

export class KnowledgeService {
  constructor({ database, clipboardMonitor, shellOpener }) {
    this.database = database;
    this.clipboardMonitor = clipboardMonitor;
    this.shellOpener = shellOpener;
    this.pendingActions = new Map();
  }

  search({ query = "", type = "all", limit = 20 } = {}) {
    const normalizedType = normalizeKnowledgeType(type);
    const items = [];

    if (normalizedType === "all" || normalizedType === "clipboard") {
      const clipboardType = type === "link" || type === "text" || type === "image" ? type : "all";
      items.push(...this.database.listClipboard({ type: clipboardType, query, limit }).map((item) => (
        this.enrich(clipboardToKnowledge(item))
      )));
    }

    if (normalizedType === "all" || normalizedType === "screenshot") {
      items.push(...this.database.listScreenshots({ query, limit }).map((item) => (
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
    const clipboard = this.database.findClipboard(id);
    if (clipboard) {
      return this.enrich(clipboardToKnowledge(clipboard));
    }

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

    await this.shellOpener.openPath(item.filePath);
    return { ok: true, item };
  }

  copy(id) {
    const item = this.get(id);
    if (!item) {
      return { ok: false, message: "未找到知识条目。" };
    }

    if (item.sourceType === "clipboard") {
      return this.clipboardMonitor.restore(item.id);
    }

    return { ok: false, message: "截图元数据暂不支持直接复制，请打开文件后复制。" };
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

export function clipboardToKnowledge(item) {
  return {
    id: item.id,
    sourceType: "clipboard",
    type: item.type,
    title: item.title,
    content: item.type === "image" ? "剪贴板图片元数据" : item.content,
    filePath: item.filePath || "",
    createdAt: item.createdAt,
    metadata: item.metadata ?? {},
    sensitive: Boolean(item.sensitive),
  };
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
  if (type === "clipboard" || type === "text" || type === "link" || type === "image") return "clipboard";
  return "all";
}

function matchesKnowledge(item, query) {
  if (!query) return true;
  return item.searchableText.toLowerCase().includes(query.toLowerCase());
}
