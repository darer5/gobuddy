window.__ModuleLoader__.load({
  id: "dsh-web-canvas",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const { createElement, useEffect, useRef, useState } = require("react");
    const { createRoot } = require("react-dom/client");
    const h = createElement;
    const api = window.goBuddy?.webCanvas;
    const DEFAULT_URL = "https://xueqiu.com/S/SH600519";
    const WIDTH_KEY = "dsh-web-canvas-width";
    const tools = [
      ["select", "↖", "浏览"], ["highlight", "▰", "高亮"], ["rectangle", "□", "框选"],
      ["arrow", "↗", "箭头"], ["freehand", "⌁", "自由线"], ["text", "T", "文字"], ["question", "?", "提问"],
    ];

    const css = `
      [data-dsh-web-canvas-root]{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .wc-entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:13px inherit;cursor:pointer}
      .wc-entry:hover,.wc-entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}
      .wc-entry-icon{width:16px;text-align:center}.wc-entry-label{white-space:nowrap}
      body[data-sidebar-collapsed="true"] .wc-entry-label,[data-sidebar-collapsed="true"] .wc-entry-label{display:none}
      body[data-dsh-web-canvas-open="1"] #root{margin-right:var(--wc-width,560px);transition:margin-right .18s ease}
      body[data-dsh-web-canvas-open="1"] #root [class*="detailsCol"]{display:none!important}
      .wc-panel{position:fixed;z-index:75;top:0;right:0;bottom:0;width:var(--wc-width,560px);display:grid;grid-template-rows:44px 40px 45px minmax(0,1fr);background:#f7f8f5;color:#18201d;border-left:1px solid #d9ded7;box-shadow:-8px 0 24px #17201912}
      .wc-resizer{position:absolute;z-index:3;left:-4px;top:0;bottom:0;width:8px;cursor:col-resize}.wc-resizer:hover:after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;background:#9eb55f}
      .wc-head,.wc-tools,.wc-browserbar{display:flex;align-items:center;min-width:0;border-bottom:1px solid #dfe3dd}
      .wc-head{gap:8px;padding:0 10px 0 14px;background:#fafbf8}.wc-head strong{font-size:13px}.wc-site{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7b867f;font-size:11px}.wc-spacer{flex:1}
      .wc-live{width:6px;height:6px;border-radius:50%;background:#68b738;box-shadow:0 0 0 3px #dff2d3}
      .wc-btn{height:28px;border:1px solid #d8ddd6;border-radius:7px;background:#fff;color:#38443e;padding:0 9px;font:11px inherit;cursor:pointer}.wc-btn:hover{border-color:#9aa69f}.wc-btn.primary{background:#1c2722;color:#fff;border-color:#1c2722}.wc-icon{width:28px;padding:0;font-size:14px}.wc-icon[data-active]{background:#d9ff43;color:#172019;border-color:#b8d536}
      .wc-tools{gap:5px;padding:5px 10px;background:#fff;overflow-x:auto}.wc-tools::-webkit-scrollbar{display:none}
      .wc-browserbar{gap:5px;padding:7px 10px;background:#f4f6f2}.wc-url{flex:1;min-width:80px;height:29px;box-sizing:border-box;border:1px solid #d8ddd6;border-radius:7px;background:#fff;padding:0 9px;font:11px ui-monospace,SFMono-Regular,monospace;outline:none}.wc-url:focus{border-color:#78905d;box-shadow:0 0 0 2px #e8f5cd}
      .wc-stage{position:relative;min-height:0;background:#e7eae5;overflow:hidden}.wc-stage-note{position:absolute;inset:0;display:grid;place-items:center;color:#7b867f;font-size:12px}
      .wc-unavailable{position:fixed;z-index:75;top:0;right:0;bottom:0;width:var(--wc-width,560px);display:grid;place-items:center;box-sizing:border-box;padding:32px;background:#f5f6f2;border-left:1px solid #d9ded7;color:#445048;text-align:center}.wc-unavailable h3{margin:0 0 8px}.wc-unavailable p{font-size:12px;line-height:1.6}.wc-unavailable button{margin-top:10px}
      @media(max-width:960px){body[data-dsh-web-canvas-open="1"] #root{margin-right:min(var(--wc-width,560px),48vw)}.wc-panel,.wc-unavailable{width:min(var(--wc-width,560px),48vw)}}
    `;

    function Panel({ onClose }) {
      const [state, setState] = useState({ context: null, annotations: [] });
      const [url, setUrl] = useState(DEFAULT_URL);
      const [activeTool, setActiveTool] = useState("select");
      const [width, setWidth] = useState(() => clamp(Number(localStorage.getItem(WIDTH_KEY)) || 560));
      const stageRef = useRef(null);
      const dragging = useRef(false);

      useEffect(() => {
        document.body.style.setProperty("--wc-width", `${width}px`);
        localStorage.setItem(WIDTH_KEY, String(width));
        requestAnimationFrame(updateBounds);
      }, [width]);

      useEffect(() => {
        const move = (event) => { if (dragging.current) setWidth(clamp(window.innerWidth - event.clientX)); };
        const up = () => { dragging.current = false; document.body.style.cursor = ""; };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      }, []);

      useEffect(() => {
        if (!api) return undefined;
        let disposed = false;
        api.open({ url, bounds: stageRef.current?.getBoundingClientRect() }).then((next) => {
          if (!disposed) { setState(next); if (next.context?.url) setUrl(next.context.url); updateBounds(); }
        });
        const unsubscribe = window.goBuddy.on("web-canvas:state", (next) => {
          if (!disposed) { setState(next); if (next.context?.url) setUrl(next.context.url); }
        });
        const observer = new ResizeObserver(updateBounds);
        if (stageRef.current) observer.observe(stageRef.current);
        window.addEventListener("resize", updateBounds);
        requestAnimationFrame(updateBounds);
        return () => { disposed = true; unsubscribe(); observer.disconnect(); window.removeEventListener("resize", updateBounds); api.close(); };
      }, []);

      function updateBounds() {
        const box = stageRef.current?.getBoundingClientRect();
        if (box && api) api.setBounds({ x: box.x, y: box.y, width: box.width, height: box.height });
      }

      if (!api) return h("div", { className: "wc-unavailable" },
        h("div", null, h("h3", null, "Web Canvas 需要 GoBuddy Desktop"), h("p", null, "浏览器预览不会获得 Electron 网页宿主权限。请在开发客户端中验证。"), h("button", { className: "wc-btn", onClick: onClose }, "关闭")));

      const context = state.context;
      const annotations = state.annotations || [];
      const sendContext = () => injectPrompt(buildPrompt("请分析我当前关注的内容。", context, annotations.at(-1) || null, annotations));
      const submitUrl = (event) => { event.preventDefault(); api.navigate(url); };
      const changeTool = (value) => { setActiveTool(value); api.setTool(value); };

      return h("aside", { className: "wc-panel", "aria-label": "Web Canvas 浏览器" },
        h("div", { className: "wc-resizer", onPointerDown: () => { dragging.current = true; document.body.style.cursor = "col-resize"; } }),
        h("header", { className: "wc-head" },
          h("span", { className: "wc-live" }), h("strong", null, "Web Canvas"),
          h("span", { className: "wc-site", title: context?.title }, context?.site || context?.title || "正在连接"),
          h("span", { className: "wc-spacer" }),
          h("button", { className: "wc-btn primary", onClick: sendContext, title: "填入中间 Harness 对话框" }, "发送上下文"),
          h("button", { className: "wc-btn wc-icon", onClick: onClose, title: "关闭 Web Canvas" }, "×"),
        ),
        h("div", { className: "wc-tools" },
          tools.map(([value, glyph, title]) => h("button", { key: value, className: "wc-btn wc-icon", "data-active": activeTool === value ? "" : undefined, title, onClick: () => changeTool(value) }, glyph)),
          h("span", { className: "wc-spacer" }),
          h("button", { className: "wc-btn", onClick: () => api.capture() }, "截图"),
          h("button", { className: "wc-btn wc-icon", onClick: () => api.undo(), title: "撤销" }, "↶"),
        ),
        h("form", { className: "wc-browserbar", onSubmit: submitUrl },
          h("button", { type: "button", className: "wc-btn wc-icon", onClick: () => api.back(), disabled: !context?.navigation?.canGoBack }, "←"),
          h("button", { type: "button", className: "wc-btn wc-icon", onClick: () => api.forward(), disabled: !context?.navigation?.canGoForward }, "→"),
          h("button", { type: "button", className: "wc-btn wc-icon", onClick: () => api.reload() }, "↻"),
          h("input", { className: "wc-url", value: url, onChange: (event) => setUrl(event.target.value), "aria-label": "网页地址" }),
          h("button", { className: "wc-btn", type: "submit" }, "打开"),
        ),
        h("section", { className: "wc-stage", ref: stageRef }, h("div", { className: "wc-stage-note" }, "正在载入网页视图…")),
      );
    }

    function buildPrompt(question, context, annotation, annotations) {
      const bundle = {
        page: context ? { url: context.url, title: context.title, site: context.site, pageType: context.pageType } : null,
        entity: context?.entity || null,
        previousEntity: context?.previousEntity || null,
        selection: context?.selection || null,
        annotation: annotation || null,
        annotationCount: annotations.length,
      };
      return `${question}\n\n以下是 Web Canvas 自动附加的结构化上下文，请优先据此理解“这里/这个”：\n${JSON.stringify(bundle, null, 2)}`;
    }

    function injectPrompt(text) {
      const own = document.querySelector("[data-dsh-web-canvas-root]");
      const candidates = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter((node) => !own?.contains(node) && node.offsetParent !== null);
      const input = candidates.at(-1);
      if (!input) { navigator.clipboard?.writeText(text); return; }
      input.focus();
      if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        input.textContent = text;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }

    function mountEntry(toggle) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshWebCanvasEntry = "";
      entry.className = "wc-entry";
      entry.setAttribute("aria-label", "Web Canvas");
      entry.innerHTML = '<span class="wc-entry-icon">◎</span><span class="wc-entry-label">Web Canvas</span>';
      entry.addEventListener("click", toggle);
      const place = () => {
        const sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
        const root = sidebar?.querySelector('[class*="logoRow"]')?.parentElement || sidebar?.firstElementChild;
        if (!root) return;
        const weread = root.querySelector("[data-dsh-weread-entry]");
        const task = root.querySelector("[data-dsh-taskboard-entry]");
        if (entry.parentElement !== root && weread?.parentElement === root) {
          root.insertBefore(entry, weread.nextElementSibling);
        } else if (entry.parentElement !== root && task?.parentElement === root) {
          root.insertBefore(entry, task);
        } else if (entry.parentElement !== root) {
          root.appendChild(entry);
        }
        // 三个入口都出现后统一归位。用一次批量移动确保最终顺序稳定，避免
        // 多个插件的 MutationObserver 在同一个微任务队列里互相触发。
        if (weread?.parentElement === root && task?.parentElement === root &&
            (weread.nextElementSibling !== entry || entry.nextElementSibling !== task)) {
          root.insertBefore(weread, task);
          root.insertBefore(entry, task);
        }
      };
      let frame = 0;
      const schedulePlace = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
      };
      const observer = new MutationObserver(schedulePlace);
      observer.observe(document.body, { childList: true, subtree: true });
      place();
      return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); entry.remove(); };
    }

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.pluginCss = "dsh-web-canvas";
        style.textContent = css;
        document.head.appendChild(style);
        const host = document.createElement("div");
        host.dataset.dshWebCanvasRoot = "";
        document.body.appendChild(host);
        const root = createRoot(host);
        let open = false;
        let entry;
        const setOpen = (next) => {
          open = Boolean(next);
          document.body.dataset.dshWebCanvasOpen = open ? "1" : "0";
          entry ||= document.querySelector("[data-dsh-web-canvas-entry]");
          if (entry) entry.toggleAttribute("data-active", open);
          root.render(open ? h(Panel, { onClose: () => setOpen(false) }) : null);
          if (!open) api?.close();
        };
        window.__dshWebCanvasSetOpen = setOpen;
        const disposeEntry = mountEntry(() => setOpen(!open));
        entry = document.querySelector("[data-dsh-web-canvas-entry]");
        return () => {
          disposeEntry(); api?.close(); root.unmount(); host.remove(); style.remove();
          delete document.body.dataset.dshWebCanvasOpen;
          document.body.style.removeProperty("--wc-width");
          delete window.__dshWebCanvasSetOpen;
        };
      }, "dsh-web-canvas: mount");
    }

    function clamp(width) { return Math.max(420, Math.min(width, window.innerWidth * 0.62)); }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});
