export async function installKnowledgeSurface(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  return window.webContents.executeJavaScript("(" + bootstrapKnowledgeSurface.toString() + ")()", true);
}

function bootstrapKnowledgeSurface() {
  if (window.__goBuddyKnowledgeSurfaceInstalled) {
    return {
      installed: true,
      hasButton: Boolean(document.querySelector(".gbk-sidebar-button")),
      hasPanel: Boolean(document.querySelector(".gbk-panel")),
    };
  }
  window.__goBuddyKnowledgeSurfaceInstalled = true;

  const state = {
    open: false,
    items: [],
    selected: null,
    loading: false,
    error: "",
    filter: "all",
  };

  const labels = {
    all: "全部",
    screenshot: "截图",
  };

  const typeLabels = {
    screenshot: "截图",
  };

  const style = document.createElement("style");
  style.id = "gobuddy-knowledge-style";
  style.textContent = `
    .gbk-sidebar-button {
      box-sizing: border-box;
      width: calc(100% - 4px);
      min-height: 34px;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 2px 8px;
      padding: 7px 12px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: var(--dsw-alias-label-primary, #202226);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
      text-align: left;
    }
    .gbk-sidebar-button:hover,
    .gbk-sidebar-button[data-active="true"] {
      background: var(--dsw-alias-interactive-bg-hover, #eef2f6);
      border-color: var(--dsw-alias-border-l2, #dde2e8);
    }
    .gbk-sidebar-icon {
      width: 16px;
      height: 16px;
      display: inline-grid;
      place-items: center;
      flex: none;
    }
    .gbk-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: var(--gbk-left, 280px);
      z-index: 1000;
      display: none;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: var(--dsw-alias-bg-base, #fbfbfa);
      color: var(--dsw-alias-label-primary, #17191c);
      border-left: 1px solid var(--dsw-alias-border-l1, #e4e7ea);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .gbk-panel[data-open="true"] {
      display: grid;
    }
    .gbk-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 28px 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, #e8ebef);
    }
    .gbk-title {
      display: grid;
      gap: 2px;
    }
    .gbk-title h1 {
      margin: 0;
      font-size: 22px;
      line-height: 30px;
      font-weight: 650;
    }
    .gbk-title p {
      margin: 0;
      color: var(--dsw-alias-label-secondary, #68707b);
      font-size: 13px;
      line-height: 20px;
    }
    .gbk-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .gbk-button {
      height: 32px;
      border: 1px solid var(--dsw-alias-border-l2, #dce1e7);
      background: var(--dsw-alias-button-elevated-fill, #fff);
      color: inherit;
      border-radius: 9px;
      padding: 0 12px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .gbk-button:hover {
      background: var(--dsw-alias-interactive-bg-hover, #f1f4f7);
    }
    .gbk-tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 28px 4px;
    }
    .gbk-tab {
      height: 30px;
      padding: 0 12px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #68707b);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .gbk-tab[data-active="true"] {
      color: var(--dsw-alias-label-primary, #17191c);
      background: var(--dsw-alias-interactive-bg-hover, #eef2f6);
      font-weight: 600;
    }
    .gbk-grid {
      min-height: 0;
      padding: 14px 28px 24px;
      overflow: auto;
      display: grid;
      align-content: start;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 12px;
    }
    .gbk-card {
      min-height: 152px;
      border: 1px solid var(--dsw-alias-border-l2, #dfe4ea);
      border-radius: 12px;
      background: var(--dsw-specific-input-major, #fff);
      padding: 12px;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 10px;
      cursor: pointer;
      text-align: left;
      color: inherit;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
    }
    .gbk-card:hover {
      border-color: var(--dsw-alias-state-business-primary, #5b8def);
      box-shadow: 0 14px 34px rgba(30, 64, 175, 0.10);
    }
    .gbk-card-top,
    .gbk-card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .gbk-pill {
      border-radius: 999px;
      background: var(--dsw-alias-interactive-bg-hover, #eef2f6);
      color: var(--dsw-alias-label-secondary, #68707b);
      padding: 2px 8px;
      font-size: 12px;
      line-height: 18px;
      white-space: nowrap;
    }
    .gbk-card h2 {
      margin: 0;
      font-size: 14px;
      line-height: 20px;
      font-weight: 650;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .gbk-preview {
      min-height: 0;
      color: var(--dsw-alias-label-secondary, #5f6874);
      font-size: 13px;
      line-height: 20px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      word-break: break-word;
    }
    .gbk-thumb {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border-radius: 9px;
      background: #f2f4f7;
      border: 1px solid var(--dsw-alias-border-l1, #e8ebef);
    }
    .gbk-empty {
      grid-column: 1 / -1;
      place-self: center;
      color: var(--dsw-alias-label-secondary, #68707b);
      text-align: center;
      padding: 80px 24px;
      line-height: 24px;
    }
    .gbk-chat {
      border-top: 1px solid var(--dsw-alias-border-l1, #e8ebef);
      padding: 14px 28px 18px;
      background: color-mix(in srgb, var(--dsw-alias-bg-base, #fbfbfa) 92%, white);
    }
    .gbk-chat-box {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      max-width: 920px;
      margin: 0 auto;
    }
    .gbk-input {
      resize: none;
      min-height: 46px;
      max-height: 120px;
      border: 1px solid var(--dsw-alias-border-l2, #dfe4ea);
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      font-size: 14px;
      line-height: 22px;
      color: inherit;
      background: var(--dsw-specific-input-major, #fff);
      outline: none;
    }
    .gbk-send {
      width: 46px;
      height: 46px;
      border: 0;
      border-radius: 14px;
      background: var(--dsw-alias-button-info-fill, #8fb2ff);
      color: white;
      font-size: 20px;
      cursor: pointer;
    }
    .gbk-dialog {
      position: fixed;
      inset: 0;
      z-index: 1001;
      display: none;
      place-items: center;
      background: rgba(15, 23, 42, 0.28);
      padding: 24px;
    }
    .gbk-dialog[data-open="true"] {
      display: grid;
    }
    .gbk-dialog-card {
      width: min(720px, 100%);
      max-height: min(720px, calc(100vh - 48px));
      overflow: auto;
      border-radius: 16px;
      background: var(--dsw-specific-input-major, #fff);
      border: 1px solid var(--dsw-alias-border-l2, #dfe4ea);
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
      padding: 20px;
      display: grid;
      gap: 14px;
    }
    .gbk-detail-content {
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--dsw-alias-label-secondary, #5f6874);
      line-height: 24px;
      font-size: 14px;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.className = "gbk-panel";
  panel.setAttribute("aria-label", "GoBuddy 截图知识库");
  panel.innerHTML = `
    <header class="gbk-header">
      <div class="gbk-title">
        <h1>知识库</h1>
        <p>最近 30 条截图内容，可直接作为对话知识库。</p>
      </div>
      <div class="gbk-actions">
        <button class="gbk-button" data-gbk-action="refresh">刷新</button>
        <button class="gbk-button" data-gbk-action="close">返回 Harness</button>
      </div>
    </header>
    <nav class="gbk-tabs" aria-label="知识类型筛选"></nav>
    <main class="gbk-grid"></main>
    <footer class="gbk-chat">
      <div class="gbk-chat-box">
        <textarea class="gbk-input" placeholder="问问这些截图：比如“帮我总结最近的截图”"></textarea>
        <button class="gbk-send" title="发送到 Harness">↑</button>
      </div>
    </footer>
  `;

  const dialog = document.createElement("div");
  dialog.className = "gbk-dialog";
  dialog.innerHTML = `<div class="gbk-dialog-card"></div>`;

  document.body.appendChild(panel);
  document.body.appendChild(dialog);

  const grid = panel.querySelector(".gbk-grid");
  const tabs = panel.querySelector(".gbk-tabs");
  const input = panel.querySelector(".gbk-input");
  const dialogCard = dialog.querySelector(".gbk-dialog-card");

  panel.querySelector('[data-gbk-action="close"]').addEventListener("click", () => setOpen(false));
  panel.querySelector('[data-gbk-action="refresh"]').addEventListener("click", () => loadItems());
  panel.querySelector(".gbk-send").addEventListener("click", () => askHarness());
  input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      askHarness();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.dataset.open = "false";
    }
  });

  function ensureSidebarButton() {
    if (document.querySelector(".gbk-sidebar-button")) {
      return;
    }

    const newSessionButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("新会话") || button.textContent?.includes("New Session"));
    if (!newSessionButton?.parentElement) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gbk-sidebar-button";
    button.innerHTML = `<span class="gbk-sidebar-icon">▦</span><span>知识库</span>`;
    button.addEventListener("click", () => setOpen(true));
    newSessionButton.insertAdjacentElement("afterend", button);
    updatePanelLeft();
  }

  function updatePanelLeft() {
    const button = document.querySelector(".gbk-sidebar-button");
    const sidebarRight = button?.closest("aside, nav, [class]")?.getBoundingClientRect?.().right
      || button?.getBoundingClientRect?.().right
      || 280;
    document.documentElement.style.setProperty("--gbk-left", `${Math.max(56, Math.round(sidebarRight))}px`);
  }

  async function setOpen(open) {
    state.open = open;
    panel.dataset.open = String(open);
    const navButton = document.querySelector(".gbk-sidebar-button");
    if (navButton) {
      navButton.dataset.active = String(open);
    }
    updatePanelLeft();
    if (open) {
      await loadItems();
    }
  }

  async function loadItems() {
    state.loading = true;
    state.error = "";
    render();
    try {
      if (!window.goBuddy?.knowledge?.listRecent) {
        throw new Error("GoBuddy 知识接口不可用");
      }
      state.items = await window.goBuddy.knowledge.listRecent({ limit: 30 });
    } catch (error) {
      state.error = error?.message || String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  function render() {
    tabs.innerHTML = Object.entries(labels).map(([type, label]) => (
      `<button class="gbk-tab" data-type="${type}" data-active="${state.filter === type}">${label}</button>`
    )).join("");
    tabs.querySelectorAll(".gbk-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.filter = tab.dataset.type;
        render();
      });
    });

    if (state.loading) {
      grid.innerHTML = `<div class="gbk-empty">正在读取最近截图...</div>`;
      return;
    }
    if (state.error) {
      grid.innerHTML = `<div class="gbk-empty">读取失败：${escapeHtml(state.error)}</div>`;
      return;
    }

    const items = filteredItems();
    if (items.length === 0) {
      grid.innerHTML = `<div class="gbk-empty">还没有可整理的截图。完成截图后再回来看看。</div>`;
      return;
    }

    grid.innerHTML = items.map((item) => cardHtml(item)).join("");
    grid.querySelectorAll(".gbk-card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id));
    });
  }

  function filteredItems() {
    if (state.filter === "all") {
      return state.items;
    }
    return state.items.filter((item) => item.type === state.filter);
  }

  function cardHtml(item) {
    const image = item.type === "image" || item.type === "screenshot";
    const preview = previewText(item);
    return `
      <button class="gbk-card" data-id="${escapeAttr(item.id)}">
        <div class="gbk-card-top">
          <span class="gbk-pill">${typeLabels[item.type] || "知识"}</span>
          <span class="gbk-pill">${formatTime(item.createdAt)}</span>
        </div>
        ${image && item.filePath ? `<img class="gbk-thumb" src="${escapeAttr(toFileUrl(item.filePath))}" alt="">` : `<div class="gbk-preview">${escapeHtml(preview)}</div>`}
        <div>
          <h2>${escapeHtml(item.title || preview)}</h2>
          ${image ? `<div class="gbk-preview">${escapeHtml(preview)}</div>` : ""}
        </div>
      </button>
    `;
  }

  function openDetail(id) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }
    const image = item.type === "image" || item.type === "screenshot";
    dialogCard.innerHTML = `
      <div class="gbk-card-meta">
        <span class="gbk-pill">${typeLabels[item.type] || "知识"}</span>
        <button class="gbk-button" data-detail="close">关闭</button>
      </div>
      <h2>${escapeHtml(item.title || "未命名知识")}</h2>
      ${image && item.filePath ? `<img class="gbk-thumb" src="${escapeAttr(toFileUrl(item.filePath))}" alt="">` : ""}
      <div class="gbk-detail-content">${escapeHtml(previewText(item, 4000))}</div>
      <div class="gbk-detail-content">时间：${escapeHtml(formatTime(item.createdAt, true))}${item.filePath ? `\n路径：${escapeHtml(item.filePath)}` : ""}</div>
      <div class="gbk-actions">
        <button class="gbk-button" data-detail="copy">复制</button>
        ${item.filePath ? `<button class="gbk-button" data-detail="open">打开文件</button>` : ""}
      </div>
    `;
    dialog.dataset.open = "true";
    dialogCard.querySelector('[data-detail="close"]')?.addEventListener("click", () => {
      dialog.dataset.open = "false";
    });
    dialogCard.querySelector('[data-detail="copy"]')?.addEventListener("click", () => {
      window.goBuddy?.knowledge?.copy(item.id);
    });
    dialogCard.querySelector('[data-detail="open"]')?.addEventListener("click", () => {
      window.goBuddy?.knowledge?.open(item.id);
    });
  }

  async function askHarness() {
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const items = state.items.length ? state.items : await window.goBuddy.knowledge.listRecent({ limit: 30 });
    const prompt = buildKnowledgePrompt(text, items.slice(0, 30));
    setOpen(false);
    const ok = submitToHarness(prompt);
    if (!ok) {
      await navigator.clipboard?.writeText(prompt).catch(() => {});
      setOpen(true);
      input.value = text;
      alert("没有找到 Harness 输入框，已尝试把带知识上下文的问题复制到剪贴板。");
      return;
    }
    input.value = "";
  }

  function submitToHarness(prompt) {
    const textarea = Array.from(document.querySelectorAll("textarea"))
      .filter((candidate) => !candidate.classList.contains("gbk-input"))
      .find((candidate) => candidate.offsetParent !== null && !candidate.disabled && !candidate.readOnly);
    if (!textarea) {
      return false;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, prompt);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    textarea.focus();

    const scope = textarea.closest("form, section, main, div") || document;
    const buttons = Array.from(scope.querySelectorAll("button")).filter((button) => !button.disabled);
    const sendButton = buttons.find((button) => /发送|send|submit/i.test(button.getAttribute("aria-label") || button.title || button.textContent || ""))
      || buttons.at(-1);
    if (!sendButton) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", ctrlKey: true }));
      return true;
    }
    setTimeout(() => sendButton.click(), 60);
    return true;
  }

  function buildKnowledgePrompt(question, items) {
    const context = items.map((item, index) => {
      const content = previewText(item, 900);
      const path = item.filePath ? `\n路径：${item.filePath}` : "";
      return `#${index + 1} [${typeLabels[item.type] || item.type}] ${item.title || "未命名"}\n时间：${formatTime(item.createdAt, true)}${path}\n内容：${content}`;
    }).join("\n\n");
    return `请基于下面的 GoBuddy 截图知识库回答用户问题。若知识库不足以回答，请明确说明不足，不要编造。\n\n用户问题：${question}\n\nGoBuddy 最近知识库（最多 30 条）：\n${context}`;
  }

  function previewText(item, limit = 260) {
    const metadata = item.metadata || {};
    const base = item.content || item.filePath || "";
    const dimensions = metadata.width && metadata.height ? `图片尺寸：${metadata.width}x${metadata.height}` : "";
    const text = [base, dimensions, item.note, ...(item.tags || [])].filter(Boolean).join("\n");
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function formatTime(value, full = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(full ? { year: "numeric", second: "2-digit" } : {}),
    }).format(date);
  }

  function toFileUrl(filePath) {
    if (!filePath) {
      return "";
    }
    let normalized = String(filePath).replaceAll("\\\\", "/");
    while (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }
    return `file:///${normalized.split("/").map(encodeURIComponent).join("/")}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  const observer = new MutationObserver(() => {
    ensureSidebarButton();
    updatePanelLeft();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", updatePanelLeft);

  ensureSidebarButton();
  return {
    installed: Boolean(window.__goBuddyKnowledgeSurfaceInstalled),
    hasButton: Boolean(document.querySelector(".gbk-sidebar-button")),
    hasPanel: Boolean(document.querySelector(".gbk-panel")),
  };
}
