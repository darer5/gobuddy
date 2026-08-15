# GoBuddy Phase 6 桌面端视觉还原与产品化 UI

## 1. 目标

Phase 6 的目标是把 `http://localhost:4173/` 的高保真产品原型设计语言迁移到现有 WPF 桌面端，让 GoBuddy 从功能验证版升级为可演示的产品化 MVP。

本阶段不使用 WebView 或 Electron，仍基于现有 WPF 工程实现；Phase 2-5 的剪贴板、截图、热键、SQLite、日志、设置、事件总线、桌宠动画能力保持可用。

## 2. 视觉基准

主要参考：

- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/public/assets/pet-cropped.png`
- `prototype/public/assets/wallpaper.png`

迁移后的 WPF 视觉重点：

- Segoe UI / Microsoft YaHei 字体栈。
- 白色半透明玻璃面板。
- 8px 圆角卡片、按钮、标签页。
- 绿色为主状态色，黄色表示高亮/Pin，红色表示危险动作。
- 宠物改用原型 bitmap 资产。
- 剪贴板、截图、AI 面板统一为卡片式托盘。

## 3. WPF 样式结构

全局样式集中在：

`src/GoBuddy.App/App.xaml`

核心资源：

| 资源 | 用途 |
| --- | --- |
| `GoBuddyFont` | 全局字体 |
| `InkBrush` | 主文本 |
| `MutedBrush` | 次级文本 |
| `GreenBrush` | 主状态色 |
| `YellowBrush` | Pin/强调 |
| `DangerBrush` | 危险动作 |
| `GlassPanelStyle` | 主玻璃面板 |
| `CardBorderStyle` | 列表卡片、截图预览、AI 卡片 |
| 默认 `Button` 样式 | 主按钮、hover、pressed、禁用态 |
| 默认 `TextBox` 样式 | 搜索框 |
| 默认 `TabItem` 样式 | 产品化分段标签 |
| 默认 `ListBoxItem` 样式 | 卡片列表项 |

资产位置：

`src/GoBuddy.App/Assets/Visual`

构建时复制：

- `pet-cropped.png`
- `wallpaper.png`

## 4. 原型映射关系

| 原型模块 | WPF 实现 |
| --- | --- |
| PetStage / pet button | `PetView.xaml` 使用 `pet-cropped.png`、状态徽标、缩放/位移动画 |
| ClipboardTray | `ToolPanel.xaml` 的 `剪贴板` tab，搜索框、过滤 chip、卡片列表、Pin/恢复/删除/清空 |
| ScreenshotLayer / screenshot state | `ScreenshotOverlayWindow` 的遮罩、选择框、尺寸标签；`ToolPanel` 的 `截图` tab 展示历史与预览 |
| AiPanel | `ToolPanel.xaml` 的 `AI` tab，展示 Codex CLI / Claude Code CLI 探测状态 |
| Glass cards | `GlassPanelStyle`、`CardBorderStyle` |
| Task/pet feedback | `PetAnimationEventController` 与 `PetView.Render` |

## 5. 实现取舍

- WPF 透明窗口无法完全等价浏览器 CSS `backdrop-filter`，因此使用半透明白色面板、阴影和卡片层级模拟玻璃质感。
- 仍保持桌面宠物透明穿透：窗口背景区域可穿透点击，宠物与面板区域可交互。
- 当前没有引入 Fluent UI WPF 图标库，使用轻量文本符号和颜色表达图标语义，避免引入大依赖。
- AI 面板仍只显示 provider 探测状态，不执行真实命令。
- 标注工具仍为预留入口，完整截图标注放入 Phase 7。

## 6. 验证记录

执行时间：2026-08-02

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `.tools\dotnet\dotnet.exe build GoBuddy.sln` | 通过，0 warning，0 error |
| 单元测试 | `.tools\dotnet\dotnet.exe test GoBuddy.sln` | 通过，47 tests |
| 透明命中 | `scripts\smoke-hit-test.ps1` | 通过 |
| 拖拽持久化 | `scripts\smoke-drag-placement.ps1` | 通过 |
| 剪贴板 SQLite | `scripts\smoke-clipboard-sqlite.ps1` | 通过 |
| 剪贴板产品化 | `scripts\smoke-phase4-clipboard-product.ps1` | 通过 |
| 截图产品化 | `scripts\smoke-screenshot-capture.ps1` | 通过 |
| 桌宠反馈 | `scripts\smoke-phase3-animation.ps1` | 通过，已输出 Phase 6 截图 |
| Phase 6 UI | `scripts\smoke-phase6-ui.ps1` | 通过，默认、截图页、AI 页截图均生成 |

视觉证据：

- `docs/phase6-ui-smoke.png`
- `docs/phase6-screenshot-panel-smoke.png`
- `docs/phase6-ai-panel-smoke.png`
- `docs/phase6-pet-feedback-smoke.png`

## 7. 已知限制

- 当前是 WPF 对原型视觉语言的产品化迁移，不是逐像素还原。
- 图标系统仍是轻量文本符号，后续可接入 Fluent UI 或自定义 icon font。
- 剪贴板和截图历史仍没有独立大面板管理视图。
- 窗口是透明桌宠窗口，视觉 smoke 的背景会受到当前桌面内容影响。
- 完整截图标注、AI CLI 执行授权、系统托盘仍待后续阶段。

## 8. Phase 7 建议

- 接入正式图标体系和更完整的 WPF 动效。
- 完成截图标注工具：画笔、箭头、文字、马赛克、撤销。
- 增加托盘菜单、设置页、开机自启动。
- 将剪贴板与截图历史合并为素材库。
- 建立更严格的视觉回归对比，把 WPF 截图与原型截图做差异评估。
