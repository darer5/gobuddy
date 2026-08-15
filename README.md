# GoBuddy Electron

GoBuddy 现在是纯 Electron 桌面应用。Electron Main 负责窗口、托盘、全局快捷键、截图、SQLite 和 IPC；React/Vite Renderer 负责 Codex 风格主界面、对话工作台和设置。

## 开发

```powershell
npm install
npm start
```

## 生产模式本地冒烟

```powershell
npm run build
npm run electron
```

`npm run electron` 会直接加载 `dist/renderer`，不依赖 Vite dev server。

## 测试

```powershell
npm test
```

当前测试覆盖快捷键解析、设置合并、SQLite CRUD 和知识服务。
