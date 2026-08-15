# GoBuddy Electron 重构说明

## 当前架构

- 桌面框架：Electron。
- Renderer：React + Vite。
- Main：窗口、托盘、全局快捷键、剪贴板监听、截图、SQLite、设置、IPC。
- 数据：Electron `app.getPath("userData")` 下的新 `gobuddy-electron.db` 和 `settings.json`。
- 旧 WPF/.NET 工程、`.sln`、旧脚本、旧测试与旧发布产物已经移除。

## 产品结构

- 左侧导航：新建对话、粘贴板、对话历史。
- 粘贴板：顶部分类 `全部 / 图片 / 文本 / 链接`，下方为历史列表和内容预览。
- 对话：仅保留 UI 占位，不接 AI 后端，不调用 Codex CLI / Claude Code CLI。
- 关闭主界面：支持退出、最小化到托盘、只保留宠物浮窗。
- 快捷键：截图默认 `Ctrl+Shift+S`；粘贴历史默认 `Ctrl+Shift+V`，支持设置页修改。
- 宠物浮窗：独立透明置顶窗口，单击宠物打开主页面，支持拖拽、点击、悬停、右键反馈和事件驱动动作。
- 宠物动作参考 Shimeji 行为模型，当前使用 `public/pet/manifest.json` 记录 `idle / blink / look / walk / poke / drag / sleep / notify / screenshot / clipboard / main-open / happy / curious` 的动作、表情和动画映射。

## 关键入口

- `electron/main/index.mjs`：Electron 应用入口和 IPC 注册。
- `electron/main/database.mjs`：SQLite schema 和持久化。
- `electron/main/clipboard.mjs`：剪贴板监听、分类、恢复。
- `electron/main/screenshot.mjs`：区域截图 overlay 和保存。
- `src/renderer/main.jsx`：主界面、宠物浮窗、截图 overlay。
- `tests/*.test.mjs`：核心行为测试。
