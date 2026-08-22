# GoBuddy Electron

GoBuddy 是一个纯 Electron 桌面生产力助手：区域截图、本地知识 Agent 与 PageLens，主界面集成 DeepSeek Harness Web 客户端。

![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.8-4D6BFE)
![AI Agent](https://img.shields.io/badge/AI%20Agent-Local-blue)
![Electron](https://img.shields.io/badge/Electron-37-47848F)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20Intel-lightgrey)

## 标签

`agent` `ai-assistant` `deepseek-harness` `local-first` `knowledge-graph` `electron` `react` `desktop-app` `screenshot` `web-canvas`

## 架构

- **Electron Main**（`electron/main/`）：窗口、托盘、全局快捷键、区域截图、SQLite 持久化、设置存储，以及 DeepSeek Harness 运行时的安装、启动与崩溃恢复。
- **Preload**（`electron/preload/`）：通过 `contextBridge` 暴露白名单 IPC 契约（`window.goBuddy` / `window.goBuddyCapture`）。
- **Renderer**（`src/renderer/`）：React + Vite，负责截图选区 overlay；主界面由 DeepSeek Harness Web 客户端提供。
- **Harness 运行时**：以独立 Node 子进程运行，随安装包自带（`vendor/`），并预置 17 个插件，包括 dshmarket、better-sidebar、Sidebar QA、Office 预览、全局规则与 PageLens。
- **PageLens**：使用隔离的 `WebContentsView` 打开第三方网页，提供页面/实体上下文、持久化标注、截图和 Agent Tools；开发模式会把仓库内插件同步到托管 Runtime，发布模式由 `vendor/` 携带。通用提问会自动附加当前页面最近一次标注。

## 开发

```powershell
npm install
npm start
```

启动后在 Harness 左侧栏点击 **PageLens**。默认打开雪球首页，也可以输入任意 HTTP/HTTPS 地址；标注可通过右侧面板发送给 Agent。

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

当前测试覆盖快捷键解析、设置合并、SQLite CRUD、知识服务、聊天 Agent、截图坐标、Harness 运行时管理，以及 PageLens URL/Adapter/标注存储和安全桥接。

## 打包

```powershell
# Windows 安装包(NSIS)
npm run dist:win

# macOS Intel x64 DMG(需在 macOS 上执行,或由 GitHub Actions 自动构建)
npm run dist:mac
```

打包前 `npm run prepare:runtime-assets` 会按当前平台重新生成 `vendor/`(Harness 运行时 + Node 运行时),不要跨平台拷贝 `vendor/`。

## macOS(Intel)

- **安装 DMG**:见 [docs/macOS使用与发布指南.md](docs/macOS使用与发布指南.md)(含 Gatekeeper 放行、系统权限、常见问题)。
- **发布流程**:推 `v*` tag 后 GitHub Actions 在 Intel macOS 构建机自动产出 `GoBuddy-<版本>-mac-x64.dmg` 并上传到 GitHub Release,详见指南第三节。
