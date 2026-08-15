import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("goBuddyPet", {
  setMode: (mode) => ipcRenderer.invoke("pet:setMode", mode),
  setPointerMode: (mode) => ipcRenderer.invoke("pet:setPointerMode", mode),
  moveBy: (delta) => ipcRenderer.invoke("pet:moveBy", delta),
  getManifest: () => ipcRenderer.invoke("pet:getManifest"),
  openMain: () => ipcRenderer.invoke("pet:openMain"),
  hide: () => ipcRenderer.invoke("pet:hide"),
  resetPosition: () => ipcRenderer.invoke("pet:resetPosition"),
  quit: () => ipcRenderer.invoke("pet:quit"),
  onEvent: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("pet:event", listener);
    return () => ipcRenderer.removeListener("pet:event", listener);
  },
});
