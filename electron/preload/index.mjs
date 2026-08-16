import { contextBridge, ipcRenderer } from "electron";

const validEvents = new Set([
  "settings:changed",
  "chat:message",
  "chat:toolCall",
  "chat:toolResult",
  "chat:status",
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
