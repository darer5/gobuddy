import fs from "node:fs";
import path from "node:path";

const TRACKING_PARAMS = new Set([
  "spm", "source", "from", "ref", "referrer", "utm_campaign", "utm_content",
  "utm_medium", "utm_source", "utm_term",
]);

export function normalizeWebUrl(input) {
  const value = String(input ?? "").trim();
  if (!value) return "https://xueqiu.com/S/SH600519";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("Web Canvas 仅允许打开 HTTP/HTTPS 页面。");
  }
  return url.href;
}

export function canonicalizeWebUrl(input) {
  const url = new URL(normalizeWebUrl(input));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) url.searchParams.delete(key);
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export function resolveAdapter(snapshot) {
  const url = new URL(snapshot.url);
  const xueqiu = /^xueqiu\.com$|\.xueqiu\.com$/i.test(url.hostname);
  if (xueqiu) {
    const stock = url.pathname.match(/^\/S\/([A-Z]{0,4}\d{4,8})/i);
    const symbol = stock?.[1]?.toUpperCase();
    return {
      site: "雪球",
      adapter: "xueqiu",
      pageType: symbol ? "stock" : url.pathname.startsWith("/status/") ? "discussion" : "generic",
      entity: symbol ? { type: "stock", id: symbol, symbol, name: inferName(snapshot.title, symbol) } : undefined,
      pageIdentity: symbol ? `xueqiu:stock:${symbol}` : `xueqiu:${canonicalizeWebUrl(url.href)}`,
    };
  }

  const github = /^github\.com$/i.test(url.hostname);
  const reading = github || /article|read|book|post|docs?/i.test(`${url.pathname} ${snapshot.title ?? ""}`);
  return {
    site: url.hostname.replace(/^www\./, "") || "网页",
    adapter: reading ? "generic-reading" : "generic",
    pageType: reading ? "article" : "generic",
    entity: reading ? { type: github ? "repo" : "article", name: snapshot.title || url.hostname } : undefined,
    pageIdentity: `web:${canonicalizeWebUrl(url.href)}`,
  };
}

export function createWebContext(snapshot, previousContext = null, now = Date.now()) {
  const adapter = resolveAdapter(snapshot);
  const canonicalUrl = canonicalizeWebUrl(snapshot.url);
  return {
    id: `ctx-${now}`,
    url: snapshot.url,
    canonicalUrl,
    title: snapshot.title || new URL(snapshot.url).hostname,
    origin: new URL(snapshot.url).origin,
    site: adapter.site,
    adapter: adapter.adapter,
    pageType: adapter.pageType,
    pageIdentity: adapter.pageIdentity,
    entity: adapter.entity,
    previousEntity: previousContext?.entity,
    navigation: snapshot.navigation ?? {},
    viewport: snapshot.viewport,
    visibleText: sanitizeVisibleText(snapshot.visibleText),
    selection: snapshot.selection?.text ? snapshot.selection : undefined,
    capturedAt: now,
  };
}

export function sanitizeVisibleText(value, maxLength = 12000) {
  return String(value ?? "")
    .replace(/\b(password|passwd|密码)\s*[:：]\s*\S+/gi, "$1：[已隐藏]")
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export class AnnotationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = this.load();
  }

  list(pageIdentity) {
    return this.items.filter((item) => !pageIdentity || item.pageIdentity === pageIdentity);
  }

  upsert(annotation) {
    const now = Date.now();
    const item = { ...annotation, updatedAt: now, createdAt: annotation.createdAt ?? now };
    const index = this.items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) this.items[index] = item;
    else this.items.push(item);
    this.save();
    return item;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length !== before) this.save();
    return this.items.length !== before;
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.items, null, 2)}\n`, "utf8");
    fs.renameSync(temp, this.filePath);
  }
}

function inferName(title, symbol) {
  const clean = String(title ?? "").replace(symbol, "").split(/[(_|｜-]/)[0].trim();
  return clean || undefined;
}
