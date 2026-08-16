# GoBuddy Electron

GoBuddy 是一个纯 Electron 桌面生产力助手：区域截图 + 本地知识 Agent，主界面集成 DeepSeek Harness Web 客户端。

![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6-4D6BFE)
![AI Agent](https://img.shields.io/badge/AI%20Agent-Local-blue)
![Electron](https://img.shields.io/badge/Electron-37-47848F)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20Intel-lightgrey)

## 标签

`agent` `ai-assistant` `deepseek-harness` `local-first` `knowledge-graph` `electron` `react` `desktop-app` `screenshot` `sqlite`

## 架构

- **Electron Main**（`electron/main/`）：窗口、托盘、全局快捷键、区域截图、SQLite 持久化、设置存储，以及 DeepSeek Harness 运行时的安装、启动与崩溃恢复。
- **Preload**（`electron/preload/`）：通过 `contextBridge` 暴露白名单 IPC 契约（`window.goBuddy` / `window.goBuddyCapture`）。
- **Renderer**（`src/renderer/`）：React + Vite，负责截图选区 overlay；主界面由 DeepSeek Harness Web 客户端提供。
- **Harness 运行时**：以独立 Node 子进程运行，随安装包自带（`vendor/`），并预置 15 个插件：Graph Memory、dsh-better-sidebar、Task Board、Git Graph、Live Stats、微信读书侧边栏、Vision Toolkit、dshmarket、全局规则、dsh-visualize、dsh-annotation、dsh-at-file、dsh-file-uploads、Aegis、OpenPencil——安装后开箱即用，无需联网下载。

## 功能

- **AI Agent 工作区**：基于 DeepSeek Harness 的本地知识 Agent，跨会话记忆（Graph Memory：知识图谱 / PageRank / 社区发现 / 向量检索）。
- **区域截图**：全局快捷键（默认 `Ctrl+Shift+S`）截图，自动保存并复制到剪贴板，写入知识库。
- **任务看板 / Git 图谱 / 实时统计 / 文件工作台 / 终端 / 内嵌浏览器**：由预置插件提供，随装随用。

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

当前测试覆盖快捷键解析、设置合并、SQLite CRUD、知识服务、聊天 Agent、截图坐标和 Harness 运行时管理。

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
