/**
 * dsh-weread-sidebar — 微信读书侧边栏（client 半 / browser bundle）
 *
 * 参照 dsh-better-sidebar 的 client 实现逻辑：
 *   - 单文件 CJS bundle，通过 window.__ModuleLoader__.load({ id, factory })
 *     注册；factory 只能 require 模块表里的表词（react、react-dom/client），
 *     其余依赖（样式、逻辑）全部内联在本文件里；
 *   - apply(ctx) 里把 UI 挂到 document.body（portal），ctx.effect 返回清理
 *     函数，保证 HMR / 卸载时干净移除；
 *   - 样式使用 DSH 主题变量（--dsw-* / --ds-*），跟随深色/浅色主题。
 *
 * UI 行为：
 *   - 右上角一个"读书"按钮，点击在窗口右侧展开"微信读书"面板；
 *   - 面板内嵌 iframe，地址是 host 半提供的同站代理
 *     （http://127.0.0.1:<port>/weread/，通过 /weread-proxy.json 获取）：
 *       * iframe 与 GUI 同 site（127.0.0.1）→ 微信读书的 SameSite cookie
 *         正常生效，扫码登录后登录态持久化；
 *       * iframe 与 GUI 不同 origin（端口不同）→ weread 页面脚本永远碰不到
 *         GUI 的数据；
 *   - 面板打开时把 #root 的 margin-right 顶开（布局让位，不遮挡对话区），
 *     关闭时面板保留挂载（display:none），阅读状态不丢失；
 *   - 面板宽度可拖拽调整，开关状态与宽度持久化到 localStorage。
 */
window.__ModuleLoader__.load({
  id: "dsh-weread-sidebar",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const { createElement, useEffect, useRef, useState, useSyncExternalStore } = require("react");
    const { createRoot } = require("react-dom/client");
    const h = createElement;

    // ============ 样式（跟随 DSH 主题变量） ============
    const STYLE_ID = "dsh-weread-sidebar/styles";
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      const tag = document.createElement("style");
      tag.setAttribute("data-plugin", "dsh-weread-sidebar");
      tag.setAttribute("data-plugin-css", STYLE_ID);
      tag.textContent = [
        "[data-dsh-weread-sidebar]{}",
        // 左侧栏入口行：与任务看板入口一致的导航样式，插在任务看板上方
        ".dsw-weread-entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 12px;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;white-space:nowrap;font-family:inherit}",
        ".dsw-weread-entry:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}",
        ".dsw-weread-entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:600}",
        ".dsw-weread-entry-icon{display:inline-flex;align-items:center;justify-content:center;flex:none}",
        ".dsw-weread-entry-label{overflow:hidden;text-overflow:ellipsis}",
        "[data-dsh-frame][data-sidebar-collapsed] .dsw-weread-entry{justify-content:center;padding:0;width:100%}",
        "[data-dsh-frame][data-sidebar-collapsed] .dsw-weread-entry-label{display:none}",
        // 右侧面板
        ".dsw-panel{position:fixed;top:0;right:0;bottom:0;z-index:80;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-10px 0 30px rgba(0,0,0,.22)}",
        "body:not([data-dsh-weread-open='1']) .dsw-panel{display:none}",
        // 面板打开时让主布局让位（只有 center 列是 1fr，margin 会落在对话区上）
        "body[data-dsh-weread-open='1'] #root{margin-right:var(--dsw-weread-width,420px);transition:margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out)}",
        "@media (prefers-reduced-motion:reduce){body[data-dsh-weread-open='1'] #root{transition:none}}",
        ".dsw-panel-header{flex:none;display:flex;align-items:center;gap:4px;height:44px;padding:0 8px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}",
        ".dsw-panel-title{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden}",
        ".dsw-panel-btn{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}",
        ".dsw-panel-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
        ".dsw-frame-wrap{flex:1;min-height:0;position:relative;display:flex}",
        ".dsw-frame{flex:1;width:100%;height:100%;border:none;background:#fff}",
        ".dsw-drag{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:2}",
        ".dsw-drag:hover{background:var(--dsw-alias-brand-primary)}",
        ".dsw-status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}",
        ".dsw-status a{color:var(--dsw-alias-brand-text)}",
      ].join("\n");
      document.head.appendChild(tag);
    }

    // ============ 状态（localStorage 持久化 + useSyncExternalStore） ============
    const STORAGE_KEY = "dsw-weread-sidebar:state";
    const listeners = new Set();
    let state = { open: false, width: 420, proxyUrl: null };
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      if (typeof saved.open === "boolean") state.open = saved.open;
      if (typeof saved.width === "number" && saved.width >= 300 && saved.width <= 720) state.width = saved.width;
    } catch { /* 读取失败用默认值 */ }

    function getState() { return state; }
    function subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
    /** 把开关状态与宽度同步到 body 属性 / CSS 变量（布局让位的依据）。 */
    function syncBody() {
      document.body.dataset.dshWereadOpen = state.open ? "1" : "0";
      document.body.style.setProperty("--dsw-weread-width", String(state.width) + "px");
    }
    function setState(patch) {
      state = Object.assign({}, state, patch);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: state.open, width: state.width }));
      } catch { /* localStorage 不可用时忽略 */ }
      syncBody();
      listeners.forEach((listener) => listener());
    }

    // ============ 图标（内联 SVG，feather 风格） ============
    function Icon(props) {
      return h("svg", {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
      }, props.children);
    }
    function BookIcon(props) {
      return h(Icon, props,
        h("path", { d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" }),
        h("path", { d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" }),
      );
    }
    function RefreshIcon(props) {
      return h(Icon, props,
        h("polyline", { points: "23 4 23 10 17 10" }),
        h("path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }),
      );
    }
    function ExternalIcon(props) {
      return h(Icon, props,
        h("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
        h("polyline", { points: "15 3 21 3 21 9" }),
        h("line", { x1: "10", y1: "14", x2: "21", y2: "3" }),
      );
    }
    function CloseIcon(props) {
      return h(Icon, props,
        h("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
        h("line", { x1: "6", y1: "6", x2: "18", y2: "18" }),
      );
    }

    // ============ 组件 ============
    // ============ 左侧栏入口（DOM 注入，仿 task-board 的 sidebar-entry） ============
    const BOOK_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';

    /** 左侧栏 shell 根元素（与任务看板相同的定位方式）。 */
    function sidebarRoot() {
      const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
      if (column === null) return undefined;
      const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
      return logoOwner ?? (column.firstElementChild ?? undefined);
    }

    /** 新建会话按钮（入口行的锚点）。 */
    function newSessionButton(root) {
      const nested = root.querySelector('button[class*="newSession"]');
      if (nested !== null) return nested;
      for (const child of root.children) {
        if (child.tagName === 'BUTTON') return child;
      }
      return undefined;
    }

    /**
     * 把「微信读书」入口行注入左侧栏，放在任务看板入口上方；
     * 没有任务看板时放在 New Session 按钮之后。MutationObserver 自愈：
     * shell 重渲染把入口移走时自动回到原位。
     * @returns {() => void} disposer
     */
    function mountSidebarEntry() {
      if (typeof document === "undefined" || document.querySelector('[data-dsh-weread-entry]') !== null) {
        return () => {};
      }
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshWereadEntry = "";
      entry.className = "dsw-weread-entry";
      entry.setAttribute("aria-label", "微信读书");
      entry.title = "微信读书（侧边栏）";
      entry.innerHTML = `<span class="dsw-weread-entry-icon">${BOOK_ICON_SVG}</span><span class="dsw-weread-entry-label">微信读书</span>`;
      entry.addEventListener("click", () => setState({ open: true }));

      const place = () => {
        const root = sidebarRoot();
        if (root === undefined) return false;
        // 任务看板存在时：入口必须紧贴在看板上方（插到它前面）。即使入口
        // 已在 root 中，也要检查相对位置——任务看板可能晚于本入口注入，
        // 把自己插到了本入口前面，需要重新夺回"看板上方"的位置。
        const taskboard = root.querySelector('[data-dsh-taskboard-entry]');
        if (taskboard !== null && taskboard.parentElement === root) {
          if (entry.parentElement === root && entry.nextElementSibling === taskboard) {
            return true;
          }
          root.insertBefore(entry, taskboard);
          return true;
        }
        if (entry.isConnected && entry.parentElement === root) return true;
        const button = newSessionButton(root);
        const base = button !== undefined ? (button.closest('[class*="logoRow"]') ?? button) : root.firstElementChild;
        root.insertBefore(entry, base?.nextElementSibling ?? null);
        return true;
      };

      let root = undefined;
      let placed = false;
      const rootObserver = new MutationObserver(() => tryPlace());
      const tryPlace = () => {
        if (root !== undefined && !root.isConnected) {
          rootObserver.disconnect();
          root = undefined;
          placed = false;
        }
        root ??= sidebarRoot();
        if (root === undefined) return;
        // 每次 root 变化都重新评估位置：任务看板可能在任何时刻注入/移动，
        // place() 内部会做位置正确性检查（正确时是 no-op）。
        placed = place();
        if (placed && root !== undefined) {
          rootObserver.observe(root, { childList: true, subtree: true });
        }
      };

      const waitObserver = new MutationObserver(() => tryPlace());
      waitObserver.observe(document.body, { childList: true, subtree: true });

      // 面板打开状态反映到入口高亮（与任务看板一致）。
      const syncActive = () => {
        if (getState().open) entry.dataset.active = "true";
        else delete entry.dataset.active;
      };
      const unsubscribe = subscribe(syncActive);
      syncActive();

      tryPlace();

      return () => {
        waitObserver.disconnect();
        rootObserver.disconnect();
        unsubscribe();
        entry.remove();
      };
    }

    function Panel() {
      const s = useSyncExternalStore(subscribe, getState);
      const [reloadKey, setReloadKey] = useState(0);
      const [drag, setDrag] = useState(null);

      // 从 GUI 同源配置路由解析代理地址（host 半提供），带重试。
      useEffect(() => {
        let cancelled = false;
        let attempts = 0;
        const tick = () => {
          window.fetch("/weread-proxy.json", { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
              if (cancelled) return;
              if (data && data.ready && data.origin) {
                if (data.origin !== s.proxyUrl) setState({ proxyUrl: data.origin });
              } else if (attempts < 40) {
                attempts += 1;
                window.setTimeout(tick, 250);
              }
            })
            .catch(() => {
              if (!cancelled && attempts < 40) {
                attempts += 1;
                window.setTimeout(tick, 250);
              }
            });
        };
        tick();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // 拖拽面板左边缘调整宽度。
      const onDragStart = (event) => {
        event.preventDefault();
        setDrag({ startX: event.clientX, startW: s.width });
      };
      useEffect(() => {
        if (drag === null) return;
        const onMove = (event) => {
          const width = Math.min(720, Math.max(300, drag.startW + (drag.startX - event.clientX)));
          setState({ width });
        };
        const onUp = () => setDrag(null);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
      }, [drag]);

      const frameSrc = s.proxyUrl ? s.proxyUrl + "/weread/" : null;
      return h("section", {
        className: "dsw-panel",
        style: { width: s.width + "px" },
        "aria-label": "微信读书侧边栏",
      },
        h("div", { className: "dsw-panel-header" },
          h("div", { className: "dsw-panel-title" },
            h(BookIcon, { width: 15, height: 15 }),
            h("span", null, "微信读书"),
          ),
          h("button", {
            type: "button",
            className: "dsw-panel-btn",
            title: "刷新",
            "aria-label": "刷新",
            onClick: () => setReloadKey((k) => k + 1),
          }, h(RefreshIcon, { width: 14, height: 14 })),
          h("button", {
            type: "button",
            className: "dsw-panel-btn",
            title: "在浏览器中打开微信读书",
            "aria-label": "在浏览器中打开微信读书",
            onClick: () => { window.open("https://weread.qq.com", "_blank", "noopener"); },
          }, h(ExternalIcon, { width: 14, height: 14 })),
          h("button", {
            type: "button",
            className: "dsw-panel-btn",
            title: "收起侧边栏",
            "aria-label": "收起侧边栏",
            onClick: () => setState({ open: false }),
          }, h(CloseIcon, { width: 14, height: 14 })),
        ),
        h("div", { className: "dsw-frame-wrap" },
          frameSrc === null
            ? h("div", { className: "dsw-status" },
                h("div", null, "正在连接微信读书…"),
                h("a", { href: "https://weread.qq.com", target: "_blank", rel: "noopener noreferrer" }, "或直接在浏览器中打开"),
              )
            : h("iframe", {
                key: String(reloadKey) + ":" + frameSrc,
                className: "dsw-frame",
                src: frameSrc,
                referrerPolicy: "no-referrer",
                allowFullScreen: true,
                title: "微信读书",
              }),
          h("div", {
            className: "dsw-drag",
            onPointerDown: onDragStart,
            title: "拖动调整宽度",
          }),
        ),
      );
    }

    function App() {
      return h("div", { "data-dsh-weread-sidebar-root": "" }, h(Panel));
    }

    // ============ 插件入口 ============
    /**
     * Client 插件主体：把侧边栏挂到 document.body（portal）。
     * @param {import('@deepseek-ai/cordis').Context} ctx - 客户端 cordis 上下文。
     */
    function apply(ctx) {
      ctx.effect(() => {
        syncBody();
        const host = document.createElement("div");
        host.setAttribute("data-dsh-weread-sidebar", "");
        document.body.appendChild(host);
        const root = createRoot(host);
        root.render(h(App));
        const disposeEntry = mountSidebarEntry();
        return () => {
          disposeEntry();
          root.unmount();
          host.remove();
        };
      }, "dsh-weread-sidebar: sidebar mount");
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});
