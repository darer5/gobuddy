const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("goBuddyCapture", {
  complete: (rect) => ipcRenderer.invoke("screenshot:completeRegionCapture", rect),
  cancel: () => ipcRenderer.invoke("screenshot:cancelRegionCapture"),
});
