import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import initSqlJs from "sql.js";

export class GoBuddyDatabase {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, "gobuddy-electron.db");
    this.db = null;
    this.SQL = null;
  }

  async initialize() {
    const sqlJsDistPath = resolveSqlJsDistPath();
    this.SQL = await initSqlJs({
      locateFile: (file) => path.join(sqlJsDistPath, file),
    });
    const bytes = fs.existsSync(this.dbPath) ? fs.readFileSync(this.dbPath) : undefined;
    this.db = new this.SQL.Database(bytes);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS clipboard_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        file_path TEXT,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source_application TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_sensitive INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_clipboard_items_created_at ON clipboard_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_clipboard_items_type ON clipboard_items(type);
      CREATE INDEX IF NOT EXISTS idx_clipboard_items_hash ON clipboard_items(content_hash);

      CREATE TABLE IF NOT EXISTS screenshot_items (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        copied_to_clipboard INTEGER NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_screenshot_items_created_at ON screenshot_items(created_at DESC);

      CREATE TABLE IF NOT EXISTS app_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        success INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON app_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_overrides (
        id TEXT PRIMARY KEY,
        note TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        references_json TEXT NOT NULL DEFAULT '[]',
        tool_events_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id, created_at);
    `);
    this.persist();
  }

  persist() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  addClipboardItem(item, limit) {
    const existing = this.get(
      "SELECT is_favorite FROM clipboard_items WHERE content_hash = ? LIMIT 1",
      [item.contentHash],
    );
    this.run("DELETE FROM clipboard_items WHERE content_hash = ?", [item.contentHash]);
    this.run(
      `INSERT INTO clipboard_items
        (id, type, title, content, file_path, content_hash, created_at, source_application, is_favorite, is_sensitive, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.type,
        item.title,
        item.content,
        item.filePath ?? null,
        item.contentHash,
        item.createdAt,
        item.sourceApplication ?? null,
        existing?.is_favorite || item.favorite ? 1 : 0,
        item.sensitive ? 1 : 0,
        JSON.stringify(item.metadata ?? {}),
      ],
    );
    this.trimClipboard(limit);
    this.persist();
  }

  listClipboard({ type = "all", query = "", limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (type && type !== "all") {
      clauses.push("type = ?");
      params.push(type);
    }
    if (query) {
      clauses.push("(title LIKE ? OR content LIKE ?)");
      params.push(`%${query}%`, `%${query}%`);
    }
    params.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.all(
      `SELECT * FROM clipboard_items ${where} ORDER BY is_favorite DESC, created_at DESC LIMIT ?`,
      params,
    ).map(mapClipboardRow);
  }

  findClipboard(id) {
    const row = this.get("SELECT * FROM clipboard_items WHERE id = ? LIMIT 1", [id]);
    return row ? mapClipboardRow(row) : null;
  }

  deleteClipboard(id) {
    this.run("DELETE FROM clipboard_items WHERE id = ?", [id]);
    this.persist();
    return true;
  }

  favoriteClipboard(id, favorite) {
    this.run("UPDATE clipboard_items SET is_favorite = ? WHERE id = ?", [favorite ? 1 : 0, id]);
    this.persist();
    return true;
  }

  trimClipboard(limit) {
    this.run(
      `DELETE FROM clipboard_items
       WHERE id IN (
         SELECT id FROM clipboard_items
         WHERE is_favorite = 0
         ORDER BY created_at DESC
         LIMIT -1 OFFSET ?
       )`,
      [limit],
    );
  }

  addScreenshot(item) {
    this.run(
      `INSERT OR REPLACE INTO screenshot_items
        (id, file_path, created_at, width, height, copied_to_clipboard, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.filePath, item.createdAt, item.width, item.height, item.copiedToClipboard ? 1 : 0, item.message],
    );
    this.persist();
  }

  listScreenshots({ query = "", limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (query) {
      clauses.push("(file_path LIKE ? OR message LIKE ?)");
      params.push(`%${query}%`, `%${query}%`);
    }
    params.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.all(
      `SELECT * FROM screenshot_items ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    ).map(mapScreenshotRow);
  }

  findScreenshot(id) {
    const row = this.get("SELECT * FROM screenshot_items WHERE id = ? LIMIT 1", [id]);
    return row ? mapScreenshotRow(row) : null;
  }

  getKnowledgeOverride(id) {
    const row = this.get("SELECT * FROM knowledge_overrides WHERE id = ? LIMIT 1", [id]);
    if (!row) {
      return { id, note: "", tags: [], updatedAt: "" };
    }

    return {
      id: row.id,
      note: row.note || "",
      tags: JSON.parse(row.tags || "[]"),
      updatedAt: row.updated_at,
    };
  }

  updateKnowledgeOverride(id, patch) {
    const current = this.getKnowledgeOverride(id);
    const next = {
      id,
      note: typeof patch.note === "string" ? patch.note : current.note,
      tags: Array.isArray(patch.tags) ? patch.tags : current.tags,
      updatedAt: new Date().toISOString(),
    };
    this.run(
      `INSERT OR REPLACE INTO knowledge_overrides (id, note, tags, updated_at)
       VALUES (?, ?, ?, ?)`,
      [next.id, next.note, JSON.stringify(next.tags), next.updatedAt],
    );
    this.persist();
    return next;
  }

  createChatSession({ id = crypto.randomUUID(), title, createdAt = new Date().toISOString() } = {}) {
    this.run(
      "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [id, title || "新对话", createdAt, createdAt],
    );
    this.persist();
    return { id, title: title || "新对话", createdAt, updatedAt: createdAt };
  }

  upsertChatSession(session) {
    const existing = this.get("SELECT * FROM chat_sessions WHERE id = ? LIMIT 1", [session.id]);
    const now = session.updatedAt || new Date().toISOString();
    if (existing) {
      this.run("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?", [
        session.title || existing.title,
        now,
        session.id,
      ]);
    } else {
      this.run(
        "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [session.id, session.title || "新对话", session.createdAt || now, now],
      );
    }
    this.persist();
    return this.findChatSession(session.id);
  }

  findChatSession(id) {
    const row = this.get("SELECT * FROM chat_sessions WHERE id = ? LIMIT 1", [id]);
    return row ? mapChatSessionRow(row) : null;
  }

  listChatSessions({ limit = 50 } = {}) {
    return this.all(
      `SELECT s.*, (
         SELECT content FROM chat_messages
         WHERE session_id = s.id
         ORDER BY created_at DESC
         LIMIT 1
       ) AS last_message
       FROM chat_sessions s
       ORDER BY updated_at DESC
       LIMIT ?`,
      [limit],
    ).map(mapChatSessionRow);
  }

  addChatMessage(message) {
    const id = message.id || crypto.randomUUID();
    const createdAt = message.createdAt || new Date().toISOString();
    this.run(
      `INSERT INTO chat_messages
        (id, session_id, role, content, references_json, tool_events_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        message.sessionId,
        message.role,
        message.content,
        JSON.stringify(message.references ?? []),
        JSON.stringify(message.toolEvents ?? []),
        createdAt,
      ],
    );
    this.run("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", [createdAt, message.sessionId]);
    this.persist();
    return { ...message, id, createdAt };
  }

  listChatMessages(sessionId) {
    return this.all(
      "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
      [sessionId],
    ).map(mapChatMessageRow);
  }

  logEvent(type, success, message) {
    this.run("INSERT INTO app_events (id, type, success, message, created_at) VALUES (?, ?, ?, ?, ?)", [
      crypto.randomUUID(),
      type,
      success ? 1 : 0,
      message,
      new Date().toISOString(),
    ]);
    this.persist();
  }

  run(sql, params = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.run(params);
    } finally {
      statement.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] ?? null;
  }

  all(sql, params = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }
}

function resolveSqlJsDistPath() {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar", "node_modules", "sql.js", "dist")
      : "",
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "sql.js", "dist")
      : "",
    path.join(process.cwd(), "node_modules", "sql.js", "dist"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "sql-wasm.wasm"))) ?? candidates.at(-1);
}

function mapClipboardRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    filePath: row.file_path || "",
    createdAt: row.created_at,
    sourceApplication: row.source_application || "unknown",
    favorite: row.is_favorite === 1,
    sensitive: row.is_sensitive === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function mapScreenshotRow(row) {
  return {
    id: row.id,
    type: "screenshot",
    title: path.basename(row.file_path || "screenshot.png"),
    filePath: row.file_path,
    createdAt: row.created_at,
    width: row.width,
    height: row.height,
    copiedToClipboard: row.copied_to_clipboard === 1,
    message: row.message,
  };
}

function mapChatSessionRow(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message || "",
  };
}

function mapChatMessageRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    references: JSON.parse(row.references_json || "[]"),
    toolEvents: JSON.parse(row.tool_events_json || "[]"),
    createdAt: row.created_at,
  };
}
