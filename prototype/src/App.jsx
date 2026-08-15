import { useMemo, useState } from "react";
import {
  Apps24Regular,
  BotSparkle24Filled,
  ChatSparkle24Regular,
  Clipboard24Filled,
  Clipboard24Regular,
  Code24Regular,
  Dismiss24Regular,
  DocumentText24Regular,
  Folder24Regular,
  FullScreenMaximize24Regular,
  Image24Regular,
  KeyCommand24Regular,
  Link24Regular,
  Pause24Filled,
  Pause24Regular,
  Pin24Regular,
  PlayCircleSparkle24Regular,
  Search24Regular,
  Settings24Regular,
  ShieldCheckmark24Filled,
  Sparkle24Filled,
  Star24Filled,
  Star24Regular,
  TextBulletListSquare24Regular,
  Wand24Regular,
  Wifi124Regular,
} from "@fluentui/react-icons";

const clips = [
  {
    id: "code",
    type: "text",
    title: "const getData = async () => {",
    body: "const res = await fetch('/api/data');",
    meta: "文本",
    time: "14:24:31",
    icon: TextBulletListSquare24Regular,
    accent: "green",
    pinned: true,
  },
  {
    id: "image",
    type: "image",
    title: "设计稿_登录页_v2.png",
    body: "PNG · 1.2 MB · 1920×1080",
    meta: "图片",
    time: "14:20:11",
    icon: Image24Regular,
    accent: "blue",
    pinned: false,
  },
  {
    id: "link",
    type: "link",
    title: "https://github.com/gobuddy-app/gobuddy",
    body: "项目仓库地址",
    meta: "链接",
    time: "14:18:07",
    icon: Link24Regular,
    accent: "orange",
    pinned: false,
  },
];

const desktopFiles = [
  { label: "此电脑", icon: Apps24Regular },
  { label: "工作资料", icon: Folder24Regular },
  { label: "PRD 文档", icon: DocumentText24Regular },
];

const petActions = [
  { id: "happy", label: "戳一下", bubble: "嘿，我在！要不要顺手整理一下剪贴板？" },
  { id: "thinking", label: "摸摸头", bubble: "我想到一个办法：可以先从最近复制的代码开始。" },
  { id: "working", label: "拖拽", bubble: "被拎起来啦。未来这里可以触发悬浮避让。" },
  { id: "sleeping", label: "休息", bubble: "我会安静待机，后台也会降频运行。" },
];

const aiProviders = [
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    status: "待连接",
    description: "面向本地代码修改、任务拆解、工作区上下文理解。",
  },
  {
    id: "claude",
    name: "Claude Code CLI",
    command: "claude",
    status: "待连接",
    description: "面向代码审阅、重构建议、长上下文项目问答。",
  },
  {
    id: "custom",
    name: "自定义本地命令",
    command: "配置中",
    status: "预留",
    description: "未来可接入其他 Agent、MCP 服务或企业内部命令。",
  },
];

export function App() {
  const [dockOpen, setDockOpen] = useState(true);
  const [screenshotMode, setScreenshotMode] = useState(true);
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [activeClip, setActiveClip] = useState("code");
  const [filter, setFilter] = useState("全部");
  const [query, setQuery] = useState("");
  const [petMood, setPetMood] = useState("thinking");
  const [petBubble, setPetBubble] = useState("框好区域后我会收进剪贴板，也可以交给 AI 做后续处理。");
  const [activeProvider, setActiveProvider] = useState("codex");

  const filteredClips = useMemo(() => {
    return clips.filter((clip) => {
      const matchesFilter =
        filter === "全部" ||
        (filter === "文本" && clip.type === "text") ||
        (filter === "图片" && clip.type === "image") ||
        (filter === "链接" && clip.type === "link");
      const text = `${clip.title} ${clip.body}`.toLowerCase();
      return matchesFilter && text.includes(query.toLowerCase());
    });
  }, [filter, query]);

  const active = clips.find((clip) => clip.id === activeClip) ?? clips[0];

  function triggerPetAction(action) {
    setPetMood(action.id);
    setPetBubble(action.bubble);
    setDockOpen(true);
  }

  function openAiAssistant() {
    setAiOpen(true);
    setPetMood("thinking");
    setPetBubble("AI 能力先做前端预留，后面可以接本地 Codex CLI、Claude Code CLI。");
  }

  function toggleScreenshot() {
    setScreenshotMode((value) => !value);
    setPetMood("working");
    setPetBubble(screenshotMode ? "截图模式先收起来。" : "开始框选吧，截完我可以交给 AI 解释或整理。");
  }

  return (
    <main className="desktop-shell">
      <section className="wallpaper" aria-label="GoBuddy 产品原型">
        <DesktopIcons />

        {screenshotMode && (
          <div className="screenshot-layer" aria-label="截图选区预览">
            <div className="shot-hint">
              <FullScreenMaximize24Regular />
              <span>拖拽选择截图区域</span>
              <kbd>Esc 取消</kbd>
            </div>
            <div className="shot-frame">
              <span className="handle handle-tl" />
              <span className="handle handle-t" />
              <span className="handle handle-tr" />
              <span className="handle handle-r" />
              <span className="handle handle-br" />
              <span className="handle handle-b" />
              <span className="handle handle-bl" />
              <span className="handle handle-l" />
              <span className="shot-size">512 × 338</span>
            </div>
          </div>
        )}

        <ClipboardTray
          active={active}
          clips={filteredClips}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          onSelect={(id) => {
            setActiveClip(id);
            setPetMood("happy");
            setPetBubble("这条我已经帮你放到前面啦。以后可以一键交给 AI 处理。");
          }}
          paused={paused}
        />

        {aiOpen && (
          <AiPanel
            activeProvider={activeProvider}
            providers={aiProviders}
            onClose={() => setAiOpen(false)}
            onProvider={setActiveProvider}
          />
        )}

        <PetStage
          dockOpen={dockOpen}
          paused={paused}
          screenshotMode={screenshotMode}
          aiOpen={aiOpen}
          mood={petMood}
          bubble={petBubble}
          actions={petActions}
          onAction={triggerPetAction}
          onToggleDock={() => {
            setDockOpen((value) => !value);
            setPetMood("happy");
            setPetBubble(dockOpen ? "我先把工具收起来。" : "工具都在这儿，点我也可以继续互动。");
          }}
          onClipboard={() => {
            setDockOpen(true);
            setPetMood("happy");
            setPetBubble("最近复制的内容都在左边。");
          }}
          onScreenshot={toggleScreenshot}
          onAi={openAiAssistant}
          onSettings={() => setSettingsOpen(true)}
          onPause={() => {
            setPaused((value) => !value);
            setPetMood(paused ? "happy" : "sleeping");
            setPetBubble(paused ? "我继续帮你看剪贴板。" : "我先不记录剪贴板啦。");
          }}
        />

        <Taskbar paused={paused} aiOpen={aiOpen} />

        {settingsOpen && (
          <SettingsPanel
            paused={paused}
            screenshotMode={screenshotMode}
            aiOpen={aiOpen}
            onClose={() => setSettingsOpen(false)}
            onPause={() => setPaused((value) => !value)}
            onScreenshot={() => setScreenshotMode((value) => !value)}
            onAi={() => setAiOpen((value) => !value)}
          />
        )}
      </section>
    </main>
  );
}

function DesktopIcons() {
  return (
    <div className="desktop-icons">
      {desktopFiles.map((file) => {
        const Icon = file.icon;
        return (
          <button className="desktop-icon" key={file.label}>
            <Icon />
            <span>{file.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClipboardTray({ active, clips, filter, onFilter, query, onQuery, onSelect, paused }) {
  return (
    <aside className="clipboard-tray" aria-label="最近剪贴板">
      <header className="tray-header">
        <div>
          <strong>剪贴板</strong>
          <span>最近 3 项</span>
        </div>
        <div className="tray-actions">
          <span className="privacy-chip">
            <ShieldCheckmark24Filled />
            本地保存
          </span>
          <button title="固定面板">
            <Pin24Regular />
          </button>
          <button title="关闭">
            <Dismiss24Regular />
          </button>
        </div>
      </header>

      <label className="search-box">
        <Search24Regular />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索剪贴板内容" />
        <kbd>Alt+V</kbd>
      </label>

      <nav className="filters" aria-label="剪贴板类型">
        {["全部", "文本", "图片", "链接"].map((item) => (
          <button className={filter === item ? "active" : ""} key={item} onClick={() => onFilter(item)}>
            {item}
          </button>
        ))}
      </nav>

      <div className="clip-list">
        {clips.map((clip) => (
          <ClipRow clip={clip} active={active.id === clip.id} key={clip.id} onSelect={() => onSelect(clip.id)} />
        ))}
        {clips.length === 0 && (
          <div className="empty-state">
            <Search24Regular />
            <span>没有匹配的剪贴板内容</span>
          </div>
        )}
      </div>

      <footer className="tray-footer">
        <span>{paused ? "监听已暂停" : "Alt + V 打开剪贴板历史"}</span>
        <button>清空</button>
      </footer>
    </aside>
  );
}

function ClipRow({ clip, active, onSelect }) {
  const Icon = clip.icon;
  return (
    <button className={`clip-row ${active ? "selected" : ""}`} onClick={onSelect}>
      <span className={`clip-icon ${clip.accent}`}>
        <Icon />
      </span>
      <span className="clip-content">
        <strong>{clip.title}</strong>
        <span>{clip.body}</span>
        <em>{clip.meta}</em>
      </span>
      <span className="clip-meta">
        <time>{clip.time}</time>
        {clip.pinned ? <Star24Filled /> : <Star24Regular />}
      </span>
    </button>
  );
}

function AiPanel({ activeProvider, providers, onClose, onProvider }) {
  const active = providers.find((provider) => provider.id === activeProvider) ?? providers[0];

  return (
    <aside className="ai-panel" aria-label="AI 助手预留面板">
      <header>
        <div className="ai-title">
          <BotSparkle24Filled />
          <div>
            <strong>Buddy AI</strong>
            <span>本地 CLI 能力预留</span>
          </div>
        </div>
        <button onClick={onClose} title="关闭 AI 面板">
          <Dismiss24Regular />
        </button>
      </header>

      <div className="provider-tabs">
        {providers.map((provider) => (
          <button
            className={activeProvider === provider.id ? "active" : ""}
            key={provider.id}
            onClick={() => onProvider(provider.id)}
          >
            {provider.name}
          </button>
        ))}
      </div>

      <section className="provider-card">
        <div>
          <Code24Regular />
          <strong>{active.name}</strong>
          <span>{active.status}</span>
        </div>
        <p>{active.description}</p>
        <code>{active.command}</code>
      </section>

      <label className="ai-prompt">
        <ChatSparkle24Regular />
        <textarea defaultValue="解释当前剪贴板里的代码，并给出可以交给本地 CLI 执行的下一步。" />
      </label>

      <div className="ai-quick-actions">
        <button>
          <Wand24Regular />
          总结剪贴板
        </button>
        <button>
          <KeyCommand24Regular />
          生成 CLI 任务
        </button>
        <button className="disabled">
          <PlayCircleSparkle24Regular />
          后端待接入
        </button>
      </div>
    </aside>
  );
}

function PetStage({
  dockOpen,
  paused,
  screenshotMode,
  aiOpen,
  mood,
  bubble,
  actions,
  onAction,
  onToggleDock,
  onClipboard,
  onScreenshot,
  onAi,
  onSettings,
  onPause,
}) {
  return (
    <section className={`pet-stage ${dockOpen ? "open" : ""} mood-${mood}`}>
      {dockOpen && (
        <div className="tool-arc" aria-label="宠物快捷工具">
          <ToolButton className="tool-clipboard" label="剪贴板" active={!screenshotMode && !aiOpen} onClick={onClipboard} icon={<Clipboard24Filled />} />
          <ToolButton className="tool-shot" label="截图" hint="Alt+Shift+S" active={screenshotMode} onClick={onScreenshot} icon={<FullScreenMaximize24Regular />} />
          <ToolButton className="tool-ai" label="AI" hint="CLI 预留" active={aiOpen} onClick={onAi} icon={<BotSparkle24Filled />} />
          <ToolButton className="tool-settings" label="设置" onClick={onSettings} icon={<Settings24Regular />} />
          <ToolButton className="tool-pause" label={paused ? "继续" : "暂停"} active={paused} onClick={onPause} icon={paused ? <Pause24Filled /> : <Pause24Regular />} />
        </div>
      )}

      <div className="pet-action-strip" aria-label="宠物互动动作">
        {actions.map((action) => (
          <button className={mood === action.id ? "active" : ""} key={action.id} onClick={() => onAction(action)}>
            {action.label}
          </button>
        ))}
      </div>

      <div className="pet-bubble">{bubble}</div>

      <button className="pet-button" onClick={onToggleDock} aria-label="打开 GoBuddy 快捷工具">
        <span className="mood-ring" />
        <img src="/assets/pet-cropped.png" alt="GoBuddy 桌面宠物" />
      </button>
    </section>
  );
}

function ToolButton({ className, label, hint, icon, active, onClick }) {
  return (
    <button className={`tool-button ${className} ${active ? "active" : ""}`} onClick={onClick}>
      <span>{icon}</span>
      <strong>{label}</strong>
      {hint && <em>{hint}</em>}
    </button>
  );
}

function SettingsPanel({ paused, screenshotMode, aiOpen, onClose, onPause, onScreenshot, onAi }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-panel" role="dialog" aria-label="GoBuddy 设置">
        <header>
          <div>
            <strong>GoBuddy 设置</strong>
            <span>桌面伙伴、效率工具与未来 AI 能力</span>
          </div>
          <button onClick={onClose} aria-label="关闭设置">
            <Dismiss24Regular />
          </button>
        </header>
        <div className="settings-grid">
          <SettingRow label="开机自启动" value="已开启" />
          <SettingRow label="宠物动作" value="点击 / 悬停 / 拖拽预留" />
          <SettingRow label="历史保留" value="30 天" />
          <SettingRow label="AI 运行方式" value="本地 CLI 优先" />
          <SettingRow label="默认快捷键" value="Alt + V" />
        </div>
        <div className="setting-actions">
          <button className={paused ? "active" : ""} onClick={onPause}>
            {paused ? "继续监听" : "暂停监听"}
          </button>
          <button className={screenshotMode ? "active" : ""} onClick={onScreenshot}>
            {screenshotMode ? "退出截图模式" : "测试截图模式"}
          </button>
          <button className={aiOpen ? "active" : ""} onClick={onAi}>
            {aiOpen ? "隐藏 AI 面板" : "显示 AI 面板"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingRow({ label, value }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Taskbar({ paused, aiOpen }) {
  return (
    <footer className="taskbar">
      <div className="task-left">
        <button className="start-button">
          <Apps24Regular />
        </button>
        <label className="task-search">
          <Search24Regular />
          <span>搜索</span>
        </label>
        <button>
          <Folder24Regular />
        </button>
        <button className="active-app">
          <Clipboard24Regular />
        </button>
        <button className={aiOpen ? "active-app ai-task" : "ai-task"}>
          <BotSparkle24Filled />
        </button>
      </div>
      <div className="task-right">
        <span className={paused ? "status paused" : "status"}>
          <ShieldCheckmark24Filled />
          {paused ? "已暂停" : "本地保存"}
        </span>
        <span className={aiOpen ? "ai-status on" : "ai-status"}>
          <Sparkle24Filled />
          AI 预留
        </span>
        <Wifi124Regular />
        <span>中</span>
        <time>14:24</time>
        <time>2026/08/02</time>
      </div>
    </footer>
  );
}
