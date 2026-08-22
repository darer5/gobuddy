const { contextBridge, ipcRenderer } = require("electron");

const validEvents = new Set([
  "settings:changed",
  "chat:message",
  "chat:toolCall",
  "chat:toolResult",
  "chat:status",
  "web-canvas:state",
  "web-canvas:error",
]);

contextBridge.exposeInMainWorld("goBuddy", {
  screenshot: {
    startRegionCapture: () => ipcRenderer.invoke("screenshot:startRegionCapture"),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (partialSettings) => ipcRenderer.invoke("settings:update", partialSettings),
  },
  hotkeys: {
    register: (hotkeys) => ipcRenderer.invoke("hotkeys:register", hotkeys),
  },
  window: {
    closeChoice: (choice) => ipcRenderer.invoke("window:closeChoice", choice),
  },
  knowledge: {
    listRecent: (query) => ipcRenderer.invoke("knowledge:listRecent", query),
    search: (query) => ipcRenderer.invoke("knowledge:search", query),
    update: (id, patch) => ipcRenderer.invoke("knowledge:update", id, patch),
    confirmAction: (actionId, approved) => ipcRenderer.invoke("knowledge:confirmAction", actionId, approved),
    open: (id) => ipcRenderer.invoke("knowledge:open", id),
  },
  harness: {
    status: () => ipcRenderer.invoke("harness:status"),
    install: () => ipcRenderer.invoke("harness:install"),
    start: () => ipcRenderer.invoke("harness:start"),
    sendMessage: (payload) => ipcRenderer.invoke("harness:sendMessage", payload),
    stop: () => ipcRenderer.invoke("harness:stop"),
    listSessions: () => ipcRenderer.invoke("harness:listSessions"),
    listMessages: (sessionId) => ipcRenderer.invoke("harness:listMessages", sessionId),
    defaultWorkspace: () => ipcRenderer.invoke("harness:defaultWorkspace"),
  },
  webCanvas: {
    open: (payload) => ipcRenderer.invoke("web-canvas:open", payload),
    close: () => ipcRenderer.invoke("web-canvas:close"),
    setSuspended: (value) => ipcRenderer.invoke("web-canvas:setSuspended", Boolean(value)),
    setBounds: (bounds) => ipcRenderer.invoke("web-canvas:setBounds", bounds),
    navigate: (url) => ipcRenderer.invoke("web-canvas:navigate", { url }),
    back: () => ipcRenderer.invoke("web-canvas:back"),
    forward: () => ipcRenderer.invoke("web-canvas:forward"),
    reload: () => ipcRenderer.invoke("web-canvas:reload"),
    setReadingMode: (value) => ipcRenderer.invoke("web-canvas:setReadingMode", Boolean(value)),
    setTool: (tool) => ipcRenderer.invoke("web-canvas:setTool", tool),
    undo: () => ipcRenderer.invoke("web-canvas:undo"),
    deleteAnnotation: (id) => ipcRenderer.invoke("web-canvas:deleteAnnotation", id),
    focusAnnotation: (id) => ipcRenderer.invoke("web-canvas:focusAnnotation", id),
    getState: () => ipcRenderer.invoke("web-canvas:getState"),
    capture: () => ipcRenderer.invoke("web-canvas:capture"),
    readAnnotationCapture: (id) => ipcRenderer.invoke("web-canvas:readAnnotationCapture", id),
  },
  on: (event, callback) => {
    if (!validEvents.has(event)) {
      return () => {};
    }

    const listener = (_, payload) => callback(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
