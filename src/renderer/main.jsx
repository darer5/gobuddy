import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Add24Regular,
  BotSparkle24Filled,
  Chat24Regular,
  Dismiss24Regular,
  History24Regular,
  Image24Regular,
  Keyboard24Regular,
  Link24Regular,
  Send24Regular,
  Settings24Regular,
  TextBulletListSquare24Regular,
} from "@fluentui/react-icons";
import "./styles.css";

const isDesktopRuntime = Boolean(window.goBuddy);
const browserRuntimeMessage = "当前是浏览器预览页，不能安装 Harness。请通过桌面快捷方式或 npm run electron 打开 GoBuddy 桌面应用。";
const api = window.goBuddy ?? createBrowserMockApi();

function Root() {
  const hash = window.location.hash;
  if (hash === "#capture") {
    return <CaptureOverlay />;
  }
  return <MainApp />;
}

function MainApp() {
  const [view, setView] = useState("chat");
  const [settings, setSettings] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [details, setDetails] = useState({ open: false, kind: "empty" });
  const collapsed = settings?.appearance?.sidebarCollapsed ?? false;

  useEffect(() => {
    api.settings.get().then(setSettings);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, []);

  async function refreshSessions() {
    const list = await api.harness.listSessions();
    setSessions(list);
  }

  async function updateAppearance(partial) {
    const next = await api.settings.update({ appearance: { ...(settings?.appearance ?? {}), ...partial } });
    setSettings(next);
  }

  function openView(nextView) {
    setView(nextView);
  }

  function openSettings() {
    setDetails({ open: true, kind: "settings" });
  }

  return (
    <main className={`app-frame ${collapsed ? "sidebar-collapsed" : ""} ${details.open ? "details-open" : ""}`} data-theme={settings?.appearance?.theme ?? "system"}>
      <aside className="sidebar">
        <div className="brand">
          <strong>GoBuddy</strong>
          <button className="icon-button collapse-button" onClick={() => updateAppearance({ sidebarCollapsed: !collapsed })} aria-label="切换侧栏">
            {collapsed ? ">" : "<"}
          </button>
        </div>
        <nav>
          <NavButton active={view === "chat"} icon={<Add24Regular />} label="新建对话" onClick={() => {
            setActiveSessionId("");
            openView("chat");
          }} />
          <NavButton active={view === "history"} icon={<History24Regular />} label="对话历史" onClick={() => openView("history")} />
        </nav>

        <section className="sidebar-sessions">
          <div className="sidebar-section-title">Sessions</div>
          {sessions.slice(0, 6).map((session) => (
            <button key={session.id} className="mini-session" onClick={() => {
              setActiveSessionId(session.id);
              openView("chat");
            }}>
              <Chat24Regular />
              <span>{session.title}</span>
            </button>
          ))}
          {sessions.length === 0 && <p>暂无会话</p>}
        </section>

        <button className="settings-button" onClick={openSettings}>
          <Settings24Regular />
          设置
        </button>
      </aside>

      <section className="conversation-plane">
        <header className="workspace-header">
          <div>
            <h1>{view === "chat" ? "新建对话" : "对话历史"}</h1>
            <p>基于 DeepSeek Harness 的本地知识 Agent 工作区。</p>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={() => api.screenshot.startRegionCapture()}>
              <Image24Regular />
              截图
            </button>
          </div>
        </header>

        {view === "chat" && <ChatView sessionId={activeSessionId} onSessionChange={setActiveSessionId} onReferenceSelect={(item) => setDetails({ open: true, kind: item.type === "tool" ? "tool" : "knowledge", item })} onSessionsChanged={refreshSessions} />}
        {view === "history" && <HistoryView onOpenSession={(sessionId) => {
          setActiveSessionId(sessionId);
          openView("chat");
        }} sessions={sessions} />}
      </section>

      <DetailsPanel
        details={details}
        settings={settings}
        onClose={() => setDetails({ open: false, kind: "empty" })}
        onSaved={setSettings}
      />
    </main>
  );
}

function NavButton({ active, icon, label, onClick }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function TypeIcon({ type }) {
  if (type === "image") return <Image24Regular />;
  if (type === "link") return <Link24Regular />;
  return <TextBulletListSquare24Regular />;
}

function ChatView({ sessionId, onSessionChange, onReferenceSelect, onSessionsChanged }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState(
    isDesktopRuntime
      ? { state: "idle", message: "知识 Agent 待命。" }
      : { state: "browser-preview", message: browserRuntimeMessage },
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isDesktopRuntime) {
      setStatus({ state: "browser-preview", message: browserRuntimeMessage });
      return undefined;
    }
    api.harness.status().then(setStatus).catch((ex) => setError(ex.message));
    return api.on("chat:status", setStatus);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    api.harness.listMessages(sessionId).then(setMessages).catch((ex) => setError(ex.message));
  }, [sessionId]);

  async function installRuntime() {
    if (!isDesktopRuntime) {
      setError(browserRuntimeMessage);
      setStatus({ state: "browser-preview", message: browserRuntimeMessage });
      return;
    }
    try {
      setError("");
      setStatus(await api.harness.install());
    } catch (ex) {
      setError(ex.message);
    }
  }

  async function startRuntime() {
    if (!isDesktopRuntime) {
      setError(browserRuntimeMessage);
      setStatus({ state: "browser-preview", message: browserRuntimeMessage });
      return;
    }
    try {
      setError("");
      setStatus(await api.harness.start());
    } catch (ex) {
      setError(ex.message);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setDraft("");
    try {
      const result = await api.harness.sendMessage({ sessionId, text });
      onSessionChange(result.session.id);
      setMessages((current) => [...current, result.userMessage, result.assistantMessage]);
      onSessionsChanged?.();
    } catch (ex) {
      setError(ex.message);
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="chat-shell live">
      <div className="chat-toolbar">
        <div>
          <strong>GoBuddy Knowledge Agent</strong>
          <span>{status.message}</span>
        </div>
        <div className="chat-toolbar-actions">
          <button onClick={installRuntime} disabled={!isDesktopRuntime || status.state === "installing"}>安装 Harness</button>
          <button onClick={startRuntime} disabled={!isDesktopRuntime || status.state === "running" || status.state === "starting"}>启动 Runtime</button>
        </div>
      </div>

      <div className="message-list">
        {messages.length === 0 && (
          <div className="chat-empty compact">
            <BotSparkle24Filled />
            <h2>用对话管理你的零散知识</h2>
            <p>可以问我有哪些截图、或者让某条知识生成待确认标签。</p>
          </div>
        )}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} onReferenceSelect={onReferenceSelect} />
        ))}
      </div>

      {error && <p className="error chat-error">{error}</p>}
      <div className={`composer ${sending ? "disabled" : ""}`}>
        <textarea
          value={draft}
          disabled={sending}
          placeholder="例如：列出今天的截图，或者帮我整理知识..."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              send();
            }
          }}
        />
        <button disabled={sending || !draft.trim()} onClick={send}>
          <Send24Regular />
        </button>
      </div>
    </section>
  );
}

function ChatMessage({ message, onReferenceSelect }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-role">{message.role === "user" ? "你" : "GoBuddy"}</div>
      <pre>{message.content}</pre>
      {message.toolEvents?.length > 0 && (
        <div className="tool-events">
          {message.toolEvents.map((event) => (
            <button key={event.id ?? event.name} onClick={() => onReferenceSelect?.({ type: "tool", title: toolLabel(event.name), content: event.name, createdAt: message.createdAt })}>{toolLabel(event.name)}</button>
          ))}
        </div>
      )}
      {message.references?.length > 0 && (
        <div className="reference-list">
          {message.references.map((item) => (
            <KnowledgeCard key={item.id} item={item} onSelect={() => onReferenceSelect?.(item)} />
          ))}
        </div>
      )}
    </article>
  );
}

function KnowledgeCard({ item, onSelect }) {
  async function openItem() {
    await api.knowledge.open(item.id);
  }

  return (
    <div className="knowledge-card">
      <TypeIcon type={item.type === "screenshot" ? "image" : item.type} />
      <button className="knowledge-card-main" onClick={onSelect}>
        <strong>{item.title}</strong>
        <span>{knowledgeLabel(item)} · {formatTime(item.createdAt)}</span>
        {item.note && <em>{item.note}</em>}
      </button>
      {item.filePath && <button onClick={openItem}>打开</button>}
    </div>
  );
}

function HistoryView({ onOpenSession, sessions }) {
  return (
    <section className="history-shell live">
      {sessions.length === 0 && <EmptyState title="还没有对话历史" description="开始一次知识对话后，会自动出现在这里。" />}
      <div className="session-list">
        {sessions.map((session) => (
          <button className="session-row" key={session.id} onClick={() => onOpenSession(session.id)}>
            <Chat24Regular />
            <span>
              <strong>{session.title}</strong>
              <em>{session.lastMessage || "暂无消息"}</em>
            </span>
            <time>{formatTime(session.updatedAt)}</time>
          </button>
        ))}
      </div>
    </section>
  );
}

function DetailsPanel({ details, settings, onClose, onSaved }) {
  const item = details.item;

  async function openKnowledge() {
    if (item?.id) await api.knowledge.open(item.id);
  }

  return (
    <aside className={`details-plane ${details.open ? "open" : ""}`}>
      <header>
        <div>
          <span>Details</span>
          <strong>{details.kind === "settings" ? "设置" : item?.title ?? "未选择内容"}</strong>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭详情">
          <Dismiss24Regular />
        </button>
      </header>

      {!details.open && <EmptyState title="Details 已收起" description="选择知识、工具调用或设置后在这里查看。" />}

      {details.open && details.kind === "settings" && settings && <SettingsPanel settings={settings} onSaved={onSaved} />}

      {details.open && details.kind === "knowledge" && item && (
        <section className="details-content">
          <div className="details-title">
            <TypeIcon type={item.type === "screenshot" ? "image" : item.type} />
            <div>
              <strong>{item.title}</strong>
              <span>{knowledgeLabel(item)} · {formatTime(item.createdAt)}</span>
            </div>
          </div>

          {item.type === "image" || item.type === "screenshot" ? (
            <img className="image-preview" src={filePathToUrl(item.filePath)} alt={item.title} />
          ) : (
            <pre>{item.content}</pre>
          )}

          {item.note && <p className="details-note">{item.note}</p>}
          {item.tags?.length > 0 && (
            <div className="tag-row">
              {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          )}

          <div className="preview-actions">
            {item.filePath && <button onClick={openKnowledge}>打开文件</button>}
          </div>
        </section>
      )}

      {details.open && details.kind === "tool" && item && (
        <section className="details-content">
          <div className="details-title">
            <BotSparkle24Filled />
            <div>
              <strong>{item.title}</strong>
              <span>工具调用摘要</span>
            </div>
          </div>
          <pre>{item.content}</pre>
        </section>
      )}
    </aside>
  );
}

function SettingsPanel({ settings, onSaved }) {
  const [screenshot, setScreenshot] = useState(settings.hotkeys.screenshot);
  const [theme, setTheme] = useState(settings.appearance?.theme ?? "system");
  const [autoStartHarness, setAutoStartHarness] = useState(settings.harness?.autoStart ?? true);
  const [error, setError] = useState("");

  async function save() {
    try {
      setError("");
      const result = await api.hotkeys.register({ screenshot });
      const saved = await api.settings.update({
        appearance: { ...(result.settings.appearance ?? settings.appearance ?? {}), theme },
        harness: { ...(result.settings.harness ?? settings.harness ?? {}), autoStart: autoStartHarness },
      });
      onSaved(saved);
    } catch (ex) {
      setError(ex.message);
    }
  }

  return (
      <section className="settings-modal inline">
        <p>快捷键、主题和 Harness 运行时设置会保存在本机。</p>
        <label>
          <Settings24Regular />
          <span>主题</span>
          <select value={theme} onChange={(event) => setTheme(event.target.value)}>
            <option value="system">跟随系统</option>
            <option value="light">亮色</option>
            <option value="dark">暗色</option>
          </select>
        </label>
        <label>
          <Keyboard24Regular />
          <span>截图快捷键</span>
          <input value={screenshot} onChange={(event) => setScreenshot(event.target.value)} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={autoStartHarness} onChange={(event) => setAutoStartHarness(event.target.checked)} />
          <span>启动 GoBuddy 时自动启动 Harness</span>
        </label>
        {error && <p className="error">{error}</p>}
        <footer>
          <button onClick={() => {
            setScreenshot("Ctrl+Shift+S");
            setTheme("system");
            setAutoStartHarness(true);
          }}>重置默认</button>
          <button className="primary" onClick={save}>保存</button>
        </footer>
      </section>
  );
}

function CaptureOverlay() {
  const [start, setStart] = useState(null);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!window.goBuddyCapture) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        window.goBuddyCapture.cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!window.goBuddyCapture) {
    return (
      <main className="capture-overlay">
        <div className="capture-tip">截图模式仅支持在桌面应用内使用。</div>
      </main>
    );
  }

  function begin(event) {
    if (event.button !== 0) {
      return;
    }
    setStart({ x: event.clientX, y: event.clientY });
    setRect({ x: event.clientX, y: event.clientY, width: 1, height: 1 });
  }

  function move(event) {
    if (!start) return;
    setRect(toRect(start, { x: event.clientX, y: event.clientY }));
  }

  function end() {
    if (!rect || rect.width < 8 || rect.height < 8) {
      window.goBuddyCapture.cancel();
      return;
    }
    window.goBuddyCapture.complete(rect);
  }

  return (
    <main className="capture-overlay" onMouseDown={begin} onMouseMove={move} onMouseUp={end}>
      <div className="capture-tip">
        <Image24Regular />
        拖拽选择截图区域
        <kbd>Esc</kbd>
      </div>
      {rect && <div className="capture-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />}
    </main>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function typeLabel(type) {
  return { image: "图片", link: "链接", text: "文本" }[type] ?? "文本";
}

function knowledgeLabel(item) {
  return { screenshot: "截图", image: "图片", link: "链接", text: "文本" }[item.type] ?? item.sourceType ?? "知识";
}

function toolLabel(name) {
  return {
    "gobuddy.search_knowledge": "检索知识库",
    "gobuddy.get_knowledge_item": "读取知识条目",
    "gobuddy.open_knowledge_item": "打开知识条目",
    "gobuddy.copy_knowledge_item": "复制知识条目",
    "gobuddy.propose_update_knowledge_item": "生成待确认整理操作",
  }[name] ?? name;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function toRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function createBrowserMockApi() {
  const mockItems = [
    { id: "1", type: "screenshot", title: "screenshot-20260815.png", content: "截图元数据：1200x720，已保存", filePath: "C:/mock/screenshot-20260815.png", createdAt: new Date().toISOString(), favorite: false },
    { id: "2", type: "screenshot", title: "screenshot-20260815-2.png", content: "截图元数据：800x600，已保存", filePath: "C:/mock/screenshot-20260815-2.png", createdAt: new Date().toISOString(), favorite: false },
  ];
  return {
    screenshot: { startRegionCapture: async () => ({ ok: true }) },
    settings: {
      get: async () => ({ hotkeys: { screenshot: "Ctrl+Shift+S" }, appearance: { theme: "system", sidebarCollapsed: false, detailsOpen: false } }),
      update: async (patch) => ({ hotkeys: patch.hotkeys ?? { screenshot: "Ctrl+Shift+S" }, appearance: patch.appearance ?? { theme: "system", sidebarCollapsed: false, detailsOpen: false } }),
    },
    hotkeys: {
      register: async () => ({
        settings: {
          hotkeys: { screenshot: "Ctrl+Shift+S" },
          appearance: { theme: "system", sidebarCollapsed: false, detailsOpen: false },
        },
        results: { screenshot: { registered: true } },
      }),
    },
    knowledge: {
      search: async () => mockItems.map((item) => ({ ...item, sourceType: "screenshot", note: "", tags: [] })),
      update: async () => ({ ok: true }),
      confirmAction: async () => ({ ok: true }),
      open: async () => ({ ok: true }),
    },
    harness: {
      status: async () => ({ state: "available", message: "浏览器预览模式：使用模拟知识 Agent。" }),
      install: async () => ({ state: "available", message: "浏览器预览模式无需安装 Harness。" }),
      start: async () => ({ state: "running", message: "模拟 Runtime 正在运行。" }),
      sendMessage: async ({ sessionId, text }) => ({
        session: { id: sessionId || "browser-session", title: text, updatedAt: new Date().toISOString() },
        userMessage: { id: `u-${Date.now()}`, role: "user", content: text, references: [], toolEvents: [], createdAt: new Date().toISOString() },
        assistantMessage: {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "我在模拟知识库里找到了这些内容。",
          references: mockItems.map((item) => ({ ...item, sourceType: "screenshot", note: "", tags: [] })),
          toolEvents: [{ id: "tool-1", name: "gobuddy.search_knowledge" }],
          createdAt: new Date().toISOString(),
        },
      }),
      stop: async () => ({ state: "available" }),
      listSessions: async () => [],
      listMessages: async () => [],
    },
    on: () => () => {},
  };
}

export function filePathToUrl(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const encoded = normalized
    .split("/")
    .map((segment, index) => (index === 0 && segment.endsWith(":") ? segment : encodeURIComponent(segment)))
    .join("/");
  return `file:///${encoded}`;
}

createRoot(document.getElementById("root")).render(<Root />);
