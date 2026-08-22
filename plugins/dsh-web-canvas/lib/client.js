window.__ModuleLoader__.load({
  id: "dsh-web-canvas",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const { createElement, useEffect, useRef, useState } = require("react");
    const { createRoot } = require("react-dom/client");
    let iconSet = {};
    try { iconSet = require("@fluentui/react-icons"); } catch { /* Host builds may expose React only. */ }
    const h = createElement;
    const api = window.goBuddy?.webCanvas;
    const DEFAULT_URL = "https://www.xueqiu.com/";
    const WIDTH_KEY = "dsh-web-canvas-width";
    const { ArrowLeft20Regular, ArrowRight20Regular, ArrowClockwise20Regular, BookOpen20Regular, Crop20Regular, Dismiss20Regular } = iconSet;

    const css = `
      [data-dsh-web-canvas-root]{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .wc-entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:13px inherit;cursor:pointer}
      .wc-entry:hover,.wc-entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}
      .wc-entry-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none}.wc-entry-icon svg{width:24px;height:24px;display:block}.wc-entry-label{white-space:nowrap}
      [data-sidebar-collapsed="true"] :is([data-dsh-web-canvas-entry],[data-dsh-taskboard-entry]){justify-content:center!important;width:100%!important;padding:0!important}
      [data-sidebar-collapsed="true"] :is([data-dsh-web-canvas-entry],[data-dsh-taskboard-entry])>span:last-child{display:none!important}
      body[data-dsh-web-canvas-open="1"] #root{margin-right:var(--wc-width,680px);transition:margin-right .18s ease}
      body[data-dsh-web-canvas-open="1"] #root [class*="detailsCol"]{display:none!important}
      .wc-panel{position:fixed;z-index:75;top:0;right:0;bottom:0;width:var(--wc-width,680px);display:grid;grid-template-rows:minmax(0,1fr) 58px;background:#f7f8f5;color:#18201d;border-left:1px solid #d9ded7;box-shadow:-8px 0 24px #17201912}
      .wc-resizer{position:absolute;z-index:3;left:-4px;top:0;bottom:0;width:8px;cursor:col-resize}.wc-resizer:hover:after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;background:#9eb55f}
      .wc-focusbar{grid-row:2;display:flex;align-items:center;gap:6px;min-width:0;padding:8px 10px;border-top:1px solid #dfe3dd;background:#fafbf8}
      .wc-btn{height:36px;box-sizing:border-box;border:1px solid #d8ddd6;border-radius:9px;background:#fff;color:#38443e;padding:0 10px;font:12px inherit;cursor:pointer;white-space:nowrap}.wc-btn:hover{border-color:#9aa69f}.wc-btn:focus-visible,.wc-url:focus-visible{outline:2px solid #78905d;outline-offset:1px}.wc-btn:disabled{opacity:.38;cursor:default}.wc-btn.primary{background:#1c2722;color:#fff;border-color:#1c2722}.wc-btn[data-active]{background:#edf5da;border-color:#b8cb8a;color:#26351c}.wc-icon{display:grid;place-items:center;width:36px;padding:0}.wc-icon svg{width:18px;height:18px}
      .wc-address{position:relative;display:flex;align-items:center;flex:1;min-width:120px;height:40px;box-sizing:border-box;border:1px solid #d8ddd6;border-radius:10px;background:#fff;padding:14px 8px 0}.wc-address:focus-within{border-color:#78905d;box-shadow:0 0 0 2px #e8f5cd}.wc-site{position:absolute;left:9px;right:9px;top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7b867f;font-size:9px;line-height:12px}.wc-url{width:100%;height:24px;box-sizing:border-box;border:0;background:transparent;padding:0;font:11px ui-monospace,SFMono-Regular,monospace;color:#26312c;outline:none}
      .wc-stage{grid-row:1;position:relative;min-height:0;background:#e7eae5;overflow:hidden}.wc-stage-note{position:absolute;inset:0;display:grid;place-items:center;color:#7b867f;font-size:12px}
      .wc-unavailable{position:fixed;z-index:75;top:0;right:0;bottom:0;width:var(--wc-width,680px);display:grid;place-items:center;box-sizing:border-box;padding:32px;background:#f5f6f2;border-left:1px solid #d9ded7;color:#445048;text-align:center}.wc-unavailable h3{margin:0 0 8px}.wc-unavailable p{font-size:12px;line-height:1.6}.wc-unavailable button{margin-top:10px}
      @media(max-width:1100px){body[data-dsh-web-canvas-open="1"] #root{margin-right:min(var(--wc-width,680px),58vw)}.wc-panel,.wc-unavailable{width:min(var(--wc-width,680px),58vw)}.wc-btn.primary{padding-inline:8px}}
      @media(max-width:760px){.wc-focusbar{gap:4px;padding-inline:6px}.wc-btn{padding-inline:7px}.wc-btn.primary{font-size:0}.wc-btn.primary:after{content:"发送";font-size:11px}.wc-reader-label,.wc-region-label{display:none}}
    `;

    function Panel({ onClose }) {
      const [state, setState] = useState({ context: null, annotations: [] });
      const [readingMode, setReadingMode] = useState(true);
      const [regionTool, setRegionTool] = useState(false);
      const [sendStatus, setSendStatus] = useState("");
      const [width, setWidth] = useState(() => clamp(Number(localStorage.getItem(WIDTH_KEY)) || 680));
      const stageRef = useRef(null);
      const urlRef = useRef(null);
      const dragging = useRef(false);
      const editingUrl = useRef(false);
      const urlDirty = useRef(false);

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
        api.open({ url: DEFAULT_URL, bounds: stageRef.current?.getBoundingClientRect() }).then((next) => {
          if (!disposed) { setState(next); syncAddress(next.context?.url); setReadingMode(next.readingMode !== false); updateBounds(); }
        });
        const unsubscribe = window.goBuddy.on("web-canvas:state", (next) => {
          if (!disposed) {
            setState(next);
            syncAddress(next.context?.url);
            if (typeof next.readingMode === "boolean") setReadingMode(next.readingMode);
          }
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

      function syncAddress(nextUrl) {
        if (nextUrl && urlRef.current && !editingUrl.current && !urlDirty.current) urlRef.current.value = nextUrl;
      }

      if (!api) return h("div", { className: "wc-unavailable" },
        h("div", null, h("h3", null, "PageLens 需要 GoBuddy Desktop"), h("p", null, "浏览器预览不会获得 Electron 网页宿主权限。请在开发客户端中验证。"), h("button", { className: "wc-btn", onClick: onClose }, "关闭")));

      const context = state.context;
      const annotations = state.annotations || [];
      const sendContext = async () => {
        injectPrompt(buildPrompt(context, annotations));
        const captures = annotations.filter((annotation) => annotation?.capturePath);
        if (!captures.length) {
          setSendStatus(annotations.length ? `已填入 ${annotations.length} 个标记区域` : "上下文已填入");
          return;
        }
        const capturePayloads = [];
        for (const [index, annotation] of captures.entries()) {
          try {
            setSendStatus(`正在读取截图 ${index + 1}/${captures.length}…`);
            const capture = await api.readAnnotationCapture(annotation.id);
            capturePayloads.push(capture);
          } catch (error) {
            console.error("[dsh-web-canvas] attach region capture failed", annotation.id, error);
          }
        }
        let attached = 0;
        try {
          if (capturePayloads.length) attached = await attachImagesToComposer(capturePayloads);
        } catch (error) {
          console.error("[dsh-web-canvas] batch attach region captures failed", error);
        }
        setSendStatus(attached === captures.length
          ? `已填入 ${annotations.length} 个区域并附加 ${attached} 张截图`
          : `已填入全部区域，成功附加 ${attached}/${captures.length} 张截图`);
      };
      const submitUrl = async (event) => {
        event.preventDefault();
        editingUrl.current = false;
        urlDirty.current = false;
        const next = await api.navigate(urlRef.current?.value || DEFAULT_URL);
        syncAddress(next?.context?.url);
      };
      const navigateHistory = (action) => {
        editingUrl.current = false;
        urlDirty.current = false;
        action();
      };

      return h("aside", { className: "wc-panel", "aria-label": "PageLens 浏览器" },
        h("div", { className: "wc-resizer", onPointerDown: () => { dragging.current = true; document.body.style.cursor = "col-resize"; } }),
        h("form", { className: "wc-focusbar", onSubmit: submitUrl },
          iconButton(ArrowLeft20Regular, "后退", () => navigateHistory(api.back), !context?.navigation?.canGoBack),
          iconButton(ArrowRight20Regular, "前进", () => navigateHistory(api.forward), !context?.navigation?.canGoForward),
          iconButton(ArrowClockwise20Regular, "刷新", () => navigateHistory(api.reload)),
          h("label", { className: "wc-address" },
            h("span", { className: "wc-site", title: context?.title }, context?.site || context?.title || "PageLens"),
            h("input", {
            ref: urlRef,
            className: "wc-url",
            defaultValue: DEFAULT_URL,
            onFocus: () => { editingUrl.current = true; },
            onBlur: () => { editingUrl.current = false; },
            onBeforeInput: (event) => event.stopPropagation(),
            onInput: (event) => { event.stopPropagation(); urlDirty.current = true; },
            onPaste: (event) => event.stopPropagation(),
            onKeyDownCapture: (event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
              if (event.key === "Escape") {
                urlDirty.current = false;
                event.currentTarget.value = context?.url || DEFAULT_URL;
                event.currentTarget.blur();
              }
            },
            onKeyUpCapture: (event) => event.stopPropagation(),
            autoComplete: "off",
            spellCheck: false,
            "aria-label": "网页地址",
          })),
          h("button", { type: "button", className: "wc-btn", "data-active": readingMode ? "" : undefined, onClick: async () => { const next = !readingMode; setReadingMode(next); await api.setReadingMode(next); }, title: readingMode ? "恢复原网页布局" : "优化侧栏阅读布局" },
            BookOpen20Regular ? h(BookOpen20Regular) : null, h("span", { className: "wc-reader-label" }, readingMode ? " 阅读中" : " 阅读")),
          h("button", { type: "button", className: "wc-btn", "data-active": regionTool ? "" : undefined, "aria-pressed": regionTool, onClick: async () => { const next = !regionTool; setRegionTool(next); await api.setTool(next ? "region" : "select"); }, title: regionTool ? "退出行情框选" : "框选行情组件并生成截图" },
            Crop20Regular ? h(Crop20Regular) : null, h("span", { className: "wc-region-label" }, regionTool ? " 框选中" : " 框选")),
          h("button", { className: "wc-btn primary", type: "button", onClick: sendContext, title: sendStatus || "填入中间 Harness 对话框，并附加所选行情截图" }, "发送上下文"),
          iconButton(Dismiss20Regular, "关闭", onClose),
        ),
        h("section", { className: "wc-stage", ref: stageRef }, h("div", { className: "wc-stage-note" }, "正在载入网页视图…")),
      );
    }

    function iconButton(Icon, label, onClick, disabled = false) {
      return h("button", { type: "button", className: "wc-btn wc-icon", onClick, disabled, title: label, "aria-label": label }, Icon ? h(Icon) : label);
    }

    function buildPrompt(context, annotations = []) {
      const title = cleanTitle(context?.title, context?.site);
      const marked = (Array.isArray(annotations) ? annotations : [annotations]).filter(Boolean);
      const regions = marked.map((annotation, index) => formatMarkedRegion(annotation, index)).filter(Boolean);
      const currentSelection = !regions.length && String(context?.selection?.text || "").trim();
      return [
        "请分析我当前关注的网页内容。",
        "",
        title && `标题：${title}`,
        context?.site && `来源：${context.site}`,
        context?.url && `链接：${context.url}`,
        regions.length && `\n共标记 ${regions.length} 个区域：\n${regions.join("\n\n")}`,
        currentSelection && `\n当前选中内容：\n${currentSelection}`,
        marked.some((annotation) => annotation.capturePath) && "\n行情截图已作为图片附件加入本次对话，并按标记区域顺序附加；请综合分析全部区域，不要只分析最后一个。",
      ].filter(Boolean).join("\n");
    }

    function formatMarkedRegion(annotation, index) {
      const selectedText = String(annotation?.selectedText || "").trim();
      const question = String(annotation?.question || "").trim();
      const imageUrl = String(annotation?.imageUrl || annotation?.anchor?.src || "").trim();
      const capturePath = String(annotation?.capturePath || "").trim();
      if (!selectedText && !question && !imageUrl && !capturePath) return "";
      return [
        `【标记区域 ${index + 1}】`,
        selectedText && `内容：\n${selectedText}`,
        imageUrl && `标记图片：${imageUrl}`,
        capturePath && `截图文件：${capturePath}`,
        question && `问题：${question}`,
      ].filter(Boolean).join("\n");
    }

    function cleanTitle(value, site) {
      const firstSegment = String(value || "").split(/[\u00a0\n]/)[0].replace(/\s+/g, " ").trim();
      const suffix = site ? new RegExp(`\\s*[-–—|]\\s*${String(site).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "i") : null;
      return (suffix ? firstSegment.replace(suffix, "") : firstSegment).slice(0, 180);
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

    async function attachImagesToComposer(captures) {
      const transfer = new DataTransfer();
      for (const [index, capture] of captures.entries()) {
        const response = await fetch(capture.dataUrl);
        const blob = await response.blob();
        const file = new File([blob], capture.fileName || `web-canvas-region-${index + 1}.png`, { type: "image/png" });
        transfer.items.add(file);
      }
      document.dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
      return transfer.files.length;
    }

    function mountEntry(toggle) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshWebCanvasEntry = "";
      entry.className = "wc-entry";
      entry.setAttribute("aria-label", "PageLens");
      entry.innerHTML = `<span class="wc-entry-icon">${TARGET_EDIT_ICON}</span><span class="wc-entry-label">PageLens</span>`;
      entry.addEventListener("click", toggle);
      const place = () => {
        const taskEntry = document.querySelector("[data-dsh-taskboard-entry]");
        const sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
        const root = taskEntry?.parentElement || sidebar?.querySelector('[class*="logoRow"]')?.parentElement || sidebar?.firstElementChild;
        if (!root) return;
        const task = root.querySelector("[data-dsh-taskboard-entry]");
        if (entry.parentElement !== root && task?.parentElement === root) {
          root.insertBefore(entry, task);
        } else if (entry.parentElement !== root) {
          root.appendChild(entry);
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
      // React 会在少数 shell 状态切换时整段替换侧栏子树；部分版本不会给
      // 插件 observer 留下稳定的重插时机。低频校验只在入口丢失/错位时写 DOM，
      // 避免 PageLens 安装成功却偶发没有入口。
      const placementTimer = window.setInterval(place, 750);
      place();
      return () => { observer.disconnect(); window.clearInterval(placementTimer); if (frame) cancelAnimationFrame(frame); entry.remove(); };
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
        let suspended = false;
        let settingsOpeningUntil = 0;
        const isVisible = (node) => {
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
        };
        const hasBlockingDialog = () => [...document.querySelectorAll(
          '[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="dialog" i]',
        )].some((node) => !host.contains(node) && isVisible(node));
        const syncNativeLayer = () => {
          const dialogOpen = hasBlockingDialog();
          if (dialogOpen) settingsOpeningUntil = 0;
          const next = open && (dialogOpen || performance.now() < settingsOpeningUntil);
          if (next === suspended) return;
          suspended = next;
          api?.setSuspended(next);
        };
        // 不经 requestAnimationFrame：当 Harness 窗口处于后台时 Chromium 会
        // 节流 rAF，导致弹窗已关闭而原生 WebContentsView 长时间不恢复。
        const modalObserver = new MutationObserver(syncNativeLayer);
        modalObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-modal"] });
        const onPossibleSettingsOpen = (event) => {
          const control = event.target?.closest?.("button,a,[role=button]");
          if (open && control?.textContent?.trim() === "设置") {
            // 先隐藏原生层，给 React 设置弹窗留出挂载时间；否则 WebContentsView
            // 会在同一次点击中重新盖回 DOM，吞掉真正的设置点击。
            settingsOpeningUntil = performance.now() + 1500;
            suspended = true;
            api?.setSuspended(true);
            window.setTimeout(syncNativeLayer, 1500);
          }
        };
        document.addEventListener("pointerdown", onPossibleSettingsOpen, true);
        const setOpen = (next) => {
          open = Boolean(next);
          if (open) document.dispatchEvent(new CustomEvent("dsh-panel-activate", { detail: "webcanvas" }));
          document.body.dataset.dshWebCanvasOpen = open ? "1" : "0";
          entry ||= document.querySelector("[data-dsh-web-canvas-entry]");
          if (entry) entry.toggleAttribute("data-active", open);
          root.render(open ? h(Panel, { onClose: () => setOpen(false) }) : null);
          if (!open) {
            suspended = false;
            api?.setSuspended(false);
            api?.close();
          } else {
            queueMicrotask(syncNativeLayer);
          }
        };
        window.__dshWebCanvasSetOpen = setOpen;
        const onOtherPanelActivate = (event) => {
          if (event.detail !== "webcanvas" && open) setOpen(false);
        };
        document.addEventListener("dsh-panel-activate", onOtherPanelActivate);
        const disposeEntry = mountEntry(() => setOpen(!open));
        entry = document.querySelector("[data-dsh-web-canvas-entry]");
        return () => {
          disposeEntry(); modalObserver.disconnect();
          document.removeEventListener("pointerdown", onPossibleSettingsOpen, true);
          document.removeEventListener("dsh-panel-activate", onOtherPanelActivate);
          api?.setSuspended(false); api?.close(); root.unmount(); host.remove(); style.remove();
          delete document.body.dataset.dshWebCanvasOpen;
          document.body.style.removeProperty("--wc-width");
          delete window.__dshWebCanvasSetOpen;
        };
      }, "dsh-web-canvas: mount");
    }

    function clamp(width) { return Math.max(420, Math.min(width, window.innerWidth * 0.62)); }

    // Generated from Fluent UI's TargetEdit24Regular icon to match Harness chrome.
    const TARGET_EDIT_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4m-6-2a6 6 0 1 1 11.99.37l-2.66 2.66A4.48 4.48 0 0 0 12 7.5a4.5 4.5 0 1 0 3.03 7.83l-2.54 2.53-.12.13H12A6 6 0 0 1 6 12m6-8.5a8.5 8.5 0 0 1 8.44 7.51 3 3 0 0 1 1.53.24A10 10 0 1 0 11 21.95q0-.27.06-.54l.24-.94A8.5 8.5 0 0 1 12 3.5m7.1 9.17-5.9 5.9q-.53.53-.7 1.25l-.47 1.83c-.2.8.53 1.52 1.32 1.32l1.83-.46q.71-.18 1.25-.7l5.9-5.9a2.29 2.29 0 0 0-3.23-3.24"/></svg>';

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});
