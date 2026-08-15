# GoBuddy Phase 0 + Phase 1 PoC 验证记录

记录日期：2026-08-02

## 1. 当前结论

Phase 0 工程骨架已创建，Phase 1 关键系统能力已形成一个可运行 PoC 应用。

当前已经自动验证：

- `GoBuddy.sln` 可构建。
- `GoBuddy.App`、`GoBuddy.Core`、`GoBuddy.Infrastructure`、`GoBuddy.Tests` 分层存在。
- 核心逻辑测试通过，当前共 11 个测试。
- PoC 桌面应用可启动并显示透明置顶桌宠窗口。
- Win32 hit-test 验证通过：透明区域穿透，宠物和面板区域可命中。
- 剪贴板文本监听验证通过：复制文本后状态和列表刷新。
- 剪贴板恢复抑制逻辑通过单元测试：恢复同一文本只抑制一次，不造成历史回环。
- 截图 overlay 热键验证通过：`Ctrl+Shift+S` 可拉起选区遮罩。
- 截图保存验证通过：模拟拖拽选区后生成 PNG 文件。
- 桌宠拖拽位置保存验证通过：模拟拖拽后写入位置文件。
- 多屏位置恢复逻辑通过虚拟多屏单元测试，当前机器为单屏环境。
- 高 DPI 已配置 `PerMonitorV2`，PoC 窗口会显示运行时 DPI；当前环境 DPI 显示为 1.00。
- AI/CLI Provider 探测只检查命令路径，不执行 Codex CLI / Claude Code CLI 真实命令。

进入 Phase 2 前建议人工补充体验验收：

- 透明区域在更多真实桌面软件上是否都稳定鼠标穿透。
- 多屏位置恢复、高 DPI 在真实多屏和 125%/150% 缩放环境下的表现。
- 剪贴板恢复按钮在真实连续复制/恢复操作下的手感。
- 截图 overlay 的取消、极小选区、跨屏选区体验。
- 全局快捷键在用户本机是否与其他软件冲突。

这些项目属于真实用户环境体验复验，不阻塞 Phase 1 PoC 关闭。

## 2. 工程结构

| 项目 | 路径 | 作用 |
| --- | --- | --- |
| Solution | `GoBuddy.sln` | 顶层解决方案 |
| App | `src/GoBuddy.App` | WPF 桌面 PoC，承载透明窗口、剪贴板、截图、热键入口 |
| Core | `src/GoBuddy.Core` | 状态机、剪贴板历史缓冲、剪贴板恢复抑制、多屏位置约束、AI Provider 模型 |
| Infrastructure | `src/GoBuddy.Infrastructure` | Windows/本机探测实现 |
| Tests | `tests/GoBuddy.Tests` | 核心逻辑和 Provider 探测测试 |
| Run Script | `scripts/run-app.ps1` | 使用本地 `.tools/dotnet` 启动 PoC 应用 |

## 3. 自动验证结果

### Build

命令：

```powershell
.\.tools\dotnet\dotnet.exe build GoBuddy.sln
```

结果：

- 通过。
- 0 warning。
- 0 error。

### Test

命令：

```powershell
.\.tools\dotnet\dotnet.exe test GoBuddy.sln --no-build
```

结果：

- 通过 11 个测试。
- 失败 0 个。
- 覆盖内容：宠物状态机优先级、状态超时回 idle、剪贴板连续去重、剪贴板重复置顶、剪贴板恢复抑制、虚拟多屏位置约束、AI/CLI Provider 探测返回计划内 provider。

### 启动 Smoke Test

命令摘要：

```powershell
$env:windir = $env:SystemRoot
.\.tools\dotnet\dotnet.exe src\GoBuddy.App\bin\Debug\net8.0-windows\GoBuddy.App.dll
```

结果：

- PoC 窗口成功显示。
- 截图证据：`docs/phase1-app-smoke.png`。

环境发现：

- 当前 Codex 执行环境存在 `SystemRoot`，但缺少 `windir`。
- WPF 字体/DPI 初始化依赖 `windir` 时会抛出 `UriFormatException`。
- `scripts/run-app.ps1` 已加入 `windir = SystemRoot` 的兜底。

## 4. 当前屏幕环境

自动读取结果：

| 设备 | 主屏 | Bounds | WorkingArea |
| --- | --- | --- | --- |
| `\\.\DISPLAY1` | true | `{X=0,Y=0,Width=1920,Height=1080}` | `{X=0,Y=0,Width=1920,Height=1032}` |

说明：

- 当前机器只有一个显示器。
- 多屏能力通过 `WindowPlacementServiceTests` 使用虚拟主屏、左侧副屏、右侧副屏坐标覆盖。
- WPF 项目配置了 `<ApplicationHighDpiMode>PerMonitorV2</ApplicationHighDpiMode>`。

## 5. 可复跑 Smoke 脚本

| 脚本 | 验证内容 | 最近结果 |
| --- | --- | --- |
| `scripts/run-app.ps1` | 使用本地 .NET SDK 启动应用 | 可启动 |
| `scripts/smoke-hit-test.ps1` | 透明区域穿透、宠物/面板命中 | 通过 |
| `scripts/smoke-drag-placement.ps1` | 拖拽后写入位置文件 | 通过 |
| `scripts/smoke-screenshot-capture.ps1` | 热键拉起 overlay，拖拽后保存截图 | 通过 |

最近 smoke 输出摘要：

- `smoke-hit-test.ps1`：`TransparentPassed=True`，`PetPassed=True`，`PanelPassed=True`。
- `smoke-drag-placement.ps1`：`PlacementFileExists=True`，示例坐标 `1560,524`。
- `smoke-screenshot-capture.ps1`：`Created=True`，`ClipboardContainsImage=True`，最新截图 `%LocalAppData%/GoBuddy/Screenshots/screenshot-20260802-094347.png`。

## 6. 详细 Smoke 记录

### Hit-Test Smoke Test

验证方式：

- 启动 PoC 窗口。
- 枚举 `GoBuddy Phase 1 PoC` 顶层窗口句柄。
- 对透明点、宠物点、面板点发送 `WM_NCHITTEST`。

结果：

| 点位 | 返回值 | 结论 |
| --- | --- | --- |
| 透明区域 | `-1` | `HTTRANSPARENT`，通过 |
| 宠物区域 | `1` | 可命中，通过 |
| 面板区域 | `1` | 可命中，通过 |

### 剪贴板 Smoke Test

验证方式：

- 启动 PoC 窗口。
- 通过 STA PowerShell 写入剪贴板文本：`GoBuddy smoke clipboard 2026-08-02`。
- 截取桌面。

结果：

- 宠物状态显示 `ClipboardCopied`。
- 剪贴板列表显示测试文本。
- 截图证据：`docs/phase1-clipboard-smoke.png`。

### 截图 Overlay 与保存 Smoke Test

验证方式：

- 启动 PoC 窗口。
- 模拟 `Ctrl+Shift+S`。
- 截取桌面确认 overlay 打开。
- 模拟拖拽选区。
- 检查截图目录是否新增 PNG 文件。

结果：

- overlay 成功打开。
- 截图证据：`docs/phase1-screenshot-overlay-smoke.png`。
- 选区截图保存成功：`%LocalAppData%/GoBuddy/Screenshots/screenshot-20260802-094347.png`。
- 剪贴板图片检查成功：`ClipboardContainsImage=True`。

### 拖拽位置保存 Smoke Test

命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-drag-placement.ps1
```

结果：

- 目标窗口：`GoBuddy Phase 1 PoC`。
- 位置文件已写入：`%LocalAppData%/GoBuddy/phase1-window.txt`。
- 示例坐标：`1560,524`。

## 7. PoC 能力状态

| 能力 | 代码位置 | 当前状态 | 验证方式 | 降级/风险 |
| --- | --- | --- | --- | --- |
| 透明置顶无边框窗口 | `src/GoBuddy.App/MainWindow.xaml` | 已实现 | 启动截图已确认窗口出现 | 若遮挡工作区，可调整默认位置或缩小面板 |
| 鼠标命中与穿透 | `src/GoBuddy.App/MainWindow.xaml.cs` | 已实现 Win32 `WM_NCHITTEST` | smoke test 通过 | 若个别软件下穿透不稳定，MVP 可退化为缩小窗口命中区域 |
| 拖拽与位置恢复 | `src/GoBuddy.App/MainWindow.xaml.cs` | 已实现 | smoke test 通过 | 位置保存到 `%LocalAppData%/GoBuddy/phase1-window.txt` |
| 多屏工作区约束 | `src/GoBuddy.Core/Display/WindowPlacementService.cs`、`src/GoBuddy.App/MainWindow.xaml.cs` | 已实现 | 虚拟多屏单测通过，当前单屏 smoke 通过 | 找不到原屏幕时 clamp 到最近工作区 |
| 高 DPI | `src/GoBuddy.App/GoBuddy.App.csproj` | 已配置 `PerMonitorV2` | UI 显示 DPI 值，启动截图 DPI 1.00 | 后续在 125%/150% 环境做体验复测 |
| 剪贴板监听 | `src/GoBuddy.App/MainWindow.xaml.cs` | 已实现 `AddClipboardFormatListener` | smoke test 通过 | 非文本内容暂不记录 |
| 剪贴板恢复抑制循环 | `src/GoBuddy.Core/Clipboard/ClipboardRestoreGuard.cs`、`src/GoBuddy.App/MainWindow.xaml.cs` | 已实现 hash + 时间窗抑制 | 单测通过 | 抑制一次后自动释放 |
| 区域截图 overlay | `src/GoBuddy.App/ScreenshotOverlayWindow.cs` | 已实现 | overlay smoke test 通过 | 选区过小会取消，异常会回传错误状态 |
| 截图保存与复制 | `src/GoBuddy.App/ScreenshotOverlayWindow.cs` | 已实现 | 模拟拖拽保存通过，剪贴板图片检查通过 | 保存路径 `%LocalAppData%/GoBuddy/Screenshots` |
| 全局快捷键 | `src/GoBuddy.App/MainWindow.xaml.cs` | 已实现 `RegisterHotKey` | 截图热键 smoke test 通过 | 注册失败时状态区显示 Win32 错误码，并保留面板按钮作为降级入口 |
| AI/CLI Provider 探测 | `src/GoBuddy.Infrastructure/Agent/AgentProviderProbe.cs` | 已实现 | 测试通过 | 仅调用 `where.exe` 查路径，不执行真实 CLI |

## 8. 开源参考

本阶段设计优先参考成熟项目/库的能力边界，而不是直接复制实现：

- ShareX：区域截图、保存和工具型截图工作流参考。
- CopyQ：剪贴板历史、收藏、去重和本地优先思路参考。
- NHotkey：WPF 全局热键能力参考。

## 9. 下一步建议

1. 将当前 PoC 代码拆成正式服务：`ClipboardService`、`HotkeyService`、`PetWindowController`、`ScreenshotService`。
2. 进入 Phase 2 基础设施开发：配置、日志、SQLite、事件总线。
3. 在真实多屏和高 DPI 设备上做体验复测，并把结果补到本文件。
