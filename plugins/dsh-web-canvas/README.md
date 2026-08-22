# dsh-web-canvas — PageLens

GoBuddy Desktop 内置的 DeepSeek Harness PageLens 插件。它通过 Electron `WebContentsView` 提供隔离的网页会话，采集最小化页面上下文，支持高亮、框选、文字、问题标注和 Agent Tools。

安全边界：远程网页禁用 Node integration，启用 context isolation 与 sandbox；Cookie 只由 Electron 持久化 Session 管理，不进入 Agent 上下文；Host Bridge 仅监听 `127.0.0.1` 且要求随机 Bearer Token。
