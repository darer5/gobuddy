# GoBuddy Phase 2 基础设施与服务层重构

记录日期：2026-08-02

## 1. 目标与结论

Phase 2 的目标是把 Phase 1 PoC 中集中在 WPF 窗口里的系统能力拆成正式服务层，并补齐后续 MVP 开发需要的基础设施。

当前结论：

- WPF 应用仍可运行，窗口标题已更新为 `GoBuddy Phase 2 PoC`。
- `MainWindow` 已从主要业务承载者收敛为窗口事件和 UI 渲染层。
- 剪贴板、热键、截图、桌宠状态/位置、设置、日志、SQLite、事件总线已经有明确服务边界。
- AI/CLI Provider 仍然只做路径探测，不执行真实命令。

## 2. 分层结构

| 层 | 路径 | 职责 |
| --- | --- | --- |
| App | `src/GoBuddy.App` | WPF 窗口、鼠标事件、窗口消息、UI 绑定 |
| Core | `src/GoBuddy.Core` | 领域模型、服务接口、事件总线、状态机、可测试业务逻辑 |
| Infrastructure | `src/GoBuddy.Infrastructure` | SQLite、JSON 设置、文件日志、Win32 热键、桌面截图、Provider 探测 |
| Tests | `tests/GoBuddy.Tests` | 单元测试与基础设施集成测试 |
| Smoke | `tools/GoBuddy.Smoke` | smoke 脚本辅助工具，例如查询 SQLite |

## 3. 服务边界

### ClipboardService

位置：

- `src/GoBuddy.Core/Clipboard/ClipboardService.cs`
- `src/GoBuddy.Core/Clipboard/ISystemClipboard.cs`
- `src/GoBuddy.App/WpfSystemClipboard.cs`
- `src/GoBuddy.Infrastructure/Storage/SqliteClipboardHistoryRepository.cs`

职责：

- 读取系统剪贴板文本。
- 写入剪贴板历史缓冲。
- 写入 SQLite 剪贴板历史表。
- 恢复历史文本到系统剪贴板。
- 使用 `ClipboardRestoreGuard` 抑制恢复动作造成的剪贴板回环。
- 发布 `ClipboardChangedEvent`。

UI 边界：

- `MainWindow` 只在收到 `WM_CLIPBOARDUPDATE` 后调用 `ClipboardService.ProcessCurrentText()`。
- `MainWindow` 不再直接维护主要剪贴板业务逻辑。

### HotkeyService

位置：

- `src/GoBuddy.Core/Hotkeys/HotkeyService.cs`
- `src/GoBuddy.Core/Hotkeys/IHotkeyNativeMethods.cs`
- `src/GoBuddy.Infrastructure/Hotkeys/Win32HotkeyNativeMethods.cs`

职责：

- 注册全局快捷键。
- 记录注册成功/失败和 Win32 错误码。
- 处理 `WM_HOTKEY` 触发。
- 发布 `HotkeyTriggeredEvent`。
- 提供 `UnregisterAll()` 统一注销。

降级：

- 注册失败时写日志，并返回可展示错误信息。
- UI 面板按钮仍可作为截图、AI 探测、退出等功能入口。

### PetWindowController

位置：

- `src/GoBuddy.Core/Pet/PetWindowController.cs`
- `src/GoBuddy.Core/Pet/PetStateMachine.cs`
- `src/GoBuddy.Core/Display/WindowPlacementService.cs`

职责：

- 管理桌宠状态切换。
- 发布 `PetStateChangedEvent`。
- 读取和保存窗口位置。
- 对窗口位置做多屏工作区约束。
- 保持 DPI 和多屏逻辑可测试。

UI 边界：

- `MainWindow` 仍负责真实鼠标拖拽坐标采集。
- 位置约束和设置落盘交给 `PetWindowController`。

### ScreenshotService

位置：

- `src/GoBuddy.Core/Screenshot/IScreenshotService.cs`
- `src/GoBuddy.Core/Screenshot/ScreenshotCaptureRequest.cs`
- `src/GoBuddy.Core/Screenshot/ScreenshotCaptureResult.cs`
- `src/GoBuddy.Infrastructure/Screenshot/DesktopScreenshotService.cs`
- `src/GoBuddy.App/ScreenshotOverlayWindow.cs`

职责：

- 接收截图选区。
- 调用桌面截图能力。
- 保存 PNG 到本地截图目录。
- 将截图复制到系统剪贴板。
- 发布 `ScreenshotCompletedEvent`。

UI 边界：

- `ScreenshotOverlayWindow` 只负责遮罩、选区和交互。
- 真实截图、保存、复制由 `DesktopScreenshotService` 执行。

### SettingsService

位置：

- `src/GoBuddy.Core/Settings/AppSettings.cs`
- `src/GoBuddy.Core/Settings/ISettingsService.cs`
- `src/GoBuddy.Infrastructure/Settings/JsonSettingsService.cs`

当前支持：

- 窗口位置。
- 快捷键配置模型。
- 截图保存目录。
- 剪贴板记录开关。
- 剪贴板历史容量。

落盘位置：

- `%LocalAppData%/GoBuddy/settings.json`

### Logging

位置：

- `src/GoBuddy.Core/Logging/IAppLogger.cs`
- `src/GoBuddy.Infrastructure/Logging/FileAppLogger.cs`

当前记录：

- 应用启动。
- 应用关闭。
- 热键注册结果。
- 剪贴板异常。
- 截图异常。
- Provider 探测异常。

落盘位置：

- `%LocalAppData%/GoBuddy/logs/gobuddy.log`

### SQLite Storage

位置：

- `src/GoBuddy.Core/Storage/IClipboardHistoryRepository.cs`
- `src/GoBuddy.Infrastructure/Storage/SqliteConnectionFactory.cs`
- `src/GoBuddy.Infrastructure/Storage/SqliteClipboardHistoryRepository.cs`

数据库位置：

- `%LocalAppData%/GoBuddy/gobuddy.db`

表结构：

```sql
CREATE TABLE IF NOT EXISTS clipboard_history (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source_application TEXT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0
);
```

索引：

```sql
CREATE INDEX IF NOT EXISTS idx_clipboard_history_created_at
    ON clipboard_history(created_at DESC);
```

## 4. 事件总线

位置：

- `src/GoBuddy.Core/Events/IEventBus.cs`
- `src/GoBuddy.Core/Events/InMemoryEventBus.cs`
- `src/GoBuddy.Core/Events/SystemEvents.cs`

当前事件：

| 事件 | 触发源 | 用途 |
| --- | --- | --- |
| `ClipboardChangedEvent` | `ClipboardService` | 剪贴板历史新增 |
| `HotkeyTriggeredEvent` | `HotkeyService` | 全局快捷键触发 |
| `ScreenshotCompletedEvent` | `DesktopScreenshotService` | 截图完成或失败 |
| `PetStateChangedEvent` | `PetWindowController` | 桌宠状态变化 |

## 5. Smoke 脚本

| 脚本 | 验证内容 | 最近结果 |
| --- | --- | --- |
| `scripts/smoke-hit-test.ps1` | 透明区域穿透、宠物/面板命中 | 通过 |
| `scripts/smoke-drag-placement.ps1` | 拖拽后写入 `settings.json` | 通过 |
| `scripts/smoke-screenshot-capture.ps1` | 热键拉起 overlay、保存 PNG、复制图片到剪贴板 | 通过 |
| `scripts/smoke-clipboard-sqlite.ps1` | 剪贴板文本写入 SQLite、日志生成 | 通过 |

最近输出摘要：

- `smoke-hit-test.ps1`：`TransparentPassed=True`，`PetPassed=True`，`PanelPassed=True`。
- `smoke-drag-placement.ps1`：`SettingsFileExists=True`，示例位置 `250,240`。
- `smoke-screenshot-capture.ps1`：`Created=True`，`ClipboardContainsImage=True`，最新截图 `%LocalAppData%/GoBuddy/Screenshots/screenshot-20260802-101031.png`。
- `smoke-clipboard-sqlite.ps1`：`MatchingRows=1`，`LogExists=True`，`LogHasStartup=True`。

## 6. 测试结果

命令：

```powershell
.\.tools\dotnet\dotnet.exe test GoBuddy.sln --no-build
```

结果：

- 通过 21 个测试。
- 失败 0 个。

覆盖范围：

- `EventBus`
- `SettingsService`
- `ClipboardService`
- `ClipboardRestoreGuard`
- `HotkeyService`
- `ScreenshotFileNameFactory`
- `SQLite repository`
- `FileAppLogger`
- `PetStateMachine`
- `WindowPlacementService`
- `AgentProviderProbe`

## 7. 已知限制

- `MainWindow` 仍直接处理 `WM_NCHITTEST` 和 `WM_CLIPBOARDUPDATE`，这是 WPF 窗口消息边界；后续可进一步封装为窗口消息适配器。
- `ScreenshotOverlayWindow` 仍属于 WPF 交互层，当前只把截图执行下沉到了 `IScreenshotService`。
- 当前 SQLite 只覆盖文本剪贴板历史，图片历史表结构留到 Phase 4。
- 当前设置服务没有迁移版本号，后续配置结构变更时需要增加 `schemaVersion`。
- 事件总线是进程内同步实现，MVP 足够；后续如有耗时订阅者，需要切异步队列。
- AI/CLI Provider 仍仅探测路径，不查询版本，不执行任务。

## 8. Phase 3 建议

1. 在当前 `PetWindowController` 基础上继续实现桌宠动画资源加载、动作打断和状态过渡。
2. 把 `MainWindow` 拆成 `PetWindow`、`ToolPanel`、`AgentPanel` 等更明确的 UI 组件。
3. 为 `PetStateChangedEvent` 增加动画层订阅者，让状态变化驱动序列帧或 Lottie/PNG 动画。
4. 加入正式的依赖注入启动流程，替换当前 `MainWindow` 构造器里的手工组装。
5. 在真实多屏和高 DPI 设备上复测窗口位置与截图坐标。
