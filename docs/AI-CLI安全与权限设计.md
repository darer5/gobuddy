# GoBuddy AI/CLI 安全与权限设计

## 1. 设计目标

GoBuddy 未来计划接入用户本地的 Codex CLI、Claude Code CLI 和自定义本地命令。该能力具有明显安全风险：读取剪贴板、读取工作区、执行命令、修改文件、访问网络。

本文档定义 AI/CLI 能力的安全边界、权限模型、风险分级、确认流程、审计日志和 MVP 降级策略。

## 2. 核心原则

- 默认不执行：MVP 阶段禁止真实 CLI 执行。
- 默认本地优先：优先使用用户本机 CLI，而不是云端服务。
- 最小上下文：只传递完成任务所需的最少内容。
- 明确确认：任何读文件、写文件、访问网络或执行命令的动作都必须明确展示给用户。
- 可取消：长任务必须可以取消。
- 可审计：任务草稿、授权、命令摘要、结果和失败原因必须可追踪。
- 不保存秘密：日志和数据库不保存 Token、Cookie、API Key、私钥、完整敏感输出。

## 3. 威胁模型

### 3.1 保护对象

- 剪贴板内容。
- 截图内容。
- 用户工作区文件。
- 用户主目录文件。
- API Key、Token、Cookie、SSH Key。
- 本地命令执行权限。
- 命令输出和错误日志。

### 3.2 主要风险

| 风险 | 示例 | 影响 |
| --- | --- | --- |
| 敏感数据泄露 | 把完整剪贴板历史传给 AI | 隐私泄露 |
| 未授权读文件 | CLI 读取整个用户目录 | 数据泄露 |
| 未授权写文件 | Agent 自动修改项目文件 | 数据损坏 |
| 命令注入 | 用户 prompt 拼接成危险命令 | 任意命令执行 |
| 网络外传 | 命令上传截图或源码 | 隐私与合规风险 |
| 日志泄露 | stdout 里包含 token 被完整保存 | 二次泄露 |
| 权限混淆 | 用户以为只是总结，实际修改文件 | 信任破坏 |

## 4. 能力阶段

| 阶段 | 能力 | 是否执行真实命令 |
| --- | --- | --- |
| MVP | Provider 展示、探测、任务草稿、权限面板 | 否 |
| Alpha | 只读探测、版本查询、帮助信息 | 仅 L0 |
| Beta | 允许用户确认后的只读上下文任务 | L0/L1 |
| 正式 | 支持受控文件修改和任务执行 | L0-L3 |
| 高级模式 | 高风险命令 | L4 默认关闭 |

## 5. Provider 模型

```json
{
  "id": "codex",
  "displayName": "Codex CLI",
  "executable": "codex",
  "status": "not_installed",
  "version": null,
  "resolvedPath": null,
  "capabilities": ["workspace_chat", "code_edit", "task_plan"],
  "enabled": false,
  "requiresApproval": true,
  "lastProbeAt": null
}
```

状态：

| 状态 | 含义 |
| --- | --- |
| not_installed | 未检测到命令 |
| pending | 尚未探测 |
| connected | 已探测到可用 |
| error | 探测失败 |
| disabled | 用户关闭 |

## 6. Provider 探测

### 6.1 允许的探测

只允许无副作用命令：

```text
codex --version
claude --version
custom --version
```

### 6.2 探测限制

- 超时时间默认 3 秒。
- 不传入剪贴板内容。
- 不传入工作区内容。
- 不继承敏感环境变量的日志输出。
- stdout/stderr 最多截取前 2KB，且经过敏感信息过滤。

### 6.3 探测结果

```json
{
  "providerId": "codex",
  "status": "connected",
  "version": "x.y.z",
  "resolvedPath": "C:\\Users\\...\\codex.exe",
  "errorMessage": null
}
```

## 7. 风险等级

| 等级 | 名称 | 说明 | 策略 |
| --- | --- | --- | --- |
| L0 | 只读探测 | 查询版本、帮助、能力 | 可自动执行，记录日志 |
| L1 | 读取有限上下文 | 当前剪贴板、单张截图、已授权工作区只读 | 首次确认，可会话记住 |
| L2 | 修改工作区 | 创建、修改、删除工作区内文件 | 每次确认 |
| L3 | 网络或依赖 | 联网、安装依赖、调用远程服务 | 强确认 |
| L4 | 高风险系统操作 | 删除目录、系统设置、用户目录批量读写 | 默认禁止 |

## 8. 上下文授权

### 8.1 ContextRef

```json
{
  "type": "clipboard_item",
  "id": "clip_01H...",
  "permission": "read",
  "summary": "当前选中的代码片段",
  "sensitive": false
}
```

支持类型：

| type | 说明 | MVP |
| --- | --- | --- |
| clipboard_item | 单条剪贴板历史 | 预留 |
| screenshot | 单张截图 | 预留 |
| workspace | 工作区目录 | 预留 |
| manual_text | 用户手动输入 | 可模拟 |

### 8.2 最小上下文原则

- 默认只传当前选中项，不传完整历史。
- 截图默认不自动传给 AI，需要用户选择。
- 工作区默认不授权。
- 用户授权目录时，只授权具体目录，不授权整个用户主目录。

## 9. 任务草稿

AI 面板不直接执行命令，而是先生成任务草稿。

```json
{
  "id": "draft_01H...",
  "providerId": "codex",
  "userPrompt": "解释当前剪贴板里的代码",
  "contextRefs": [
    {
      "type": "clipboard_item",
      "id": "clip_01H..."
    }
  ],
  "proposedCommand": "codex exec \"解释当前剪贴板里的代码\"",
  "workingDirectory": "D:\\GoBuddy",
  "riskLevel": "L1",
  "status": "waiting_for_confirmation"
}
```

MVP 要求：

- 可以生成草稿对象。
- 可以展示草稿。
- 不调用真实 CLI。
- `StartTask` 返回 `provider_not_enabled` 或 `execution_disabled_in_mvp`。

## 10. 权限确认

### 10.1 确认面板必须展示

- Provider。
- 命令摘要。
- 工作目录。
- 风险等级。
- 将读取的上下文。
- 将写入的范围。
- 是否访问网络。
- 是否保存审计记录。
- 是否允许记住本次授权。

### 10.2 权限确认对象

```json
{
  "draftId": "draft_01H...",
  "providerId": "codex",
  "riskLevel": "L2",
  "proposedCommand": "codex exec \"修复当前项目中的构建错误\"",
  "workingDirectory": "D:\\GoBuddy",
  "willRead": ["workspace:D:\\GoBuddy", "clipboard:clip_01H..."],
  "willWrite": ["workspace:D:\\GoBuddy"],
  "networkAccess": false,
  "requiresUserConfirmation": true,
  "canRememberForSession": false
}
```

### 10.3 确认策略

| 风险等级 | 是否可自动 | 是否可记住 |
| --- | --- | --- |
| L0 | 是 | 是 |
| L1 | 否，首次确认 | 可会话记住 |
| L2 | 否 | 不可默认记住 |
| L3 | 否，强确认 | 不可记住 |
| L4 | 默认禁止 | 不可记住 |

## 11. 命令构造安全

### 11.1 禁止字符串拼接执行

禁止：

```csharp
Process.Start("cmd.exe", "/c " + userPrompt);
```

要求：

- 使用 `ProcessStartInfo.ArgumentList`。
- Provider 定义固定 executable。
- 用户 prompt 作为参数传递，不拼接 shell。
- 默认不走 `cmd.exe /c` 或 PowerShell。

### 11.2 ProcessStartInfo 要求

```csharp
var startInfo = new ProcessStartInfo
{
    FileName = provider.ExecutablePath,
    UseShellExecute = false,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
    CreateNoWindow = true,
    WorkingDirectory = approvedWorkingDirectory
};
startInfo.ArgumentList.Add("exec");
startInfo.ArgumentList.Add(userPrompt);
```

## 12. 输出处理

### 12.1 stdout/stderr

- 流式读取。
- UI 展示时可折叠。
- 日志保存摘要，不保存完整输出。
- 单任务输出设置最大缓存，例如 1MB。
- 命中敏感规则时打码。

### 12.2 敏感信息打码

默认规则：

- API Key。
- Bearer Token。
- GitHub token。
- SSH private key。
- PEM private key。
- Cookie。
- Windows 用户主目录绝对路径可部分打码。

## 13. 审计日志

### 13.1 记录内容

```json
{
  "taskId": "task_01H...",
  "providerId": "codex",
  "riskLevel": "L2",
  "commandSummary": "codex exec <prompt>",
  "workingDirectoryHash": "sha256...",
  "willRead": ["workspace"],
  "willWrite": ["workspace"],
  "approved": true,
  "approvedAt": "2026-08-02T14:24:31+08:00",
  "exitCode": 0,
  "resultSummary": "任务完成",
  "createdAt": "2026-08-02T14:24:00+08:00"
}
```

### 13.2 不记录内容

- 完整 prompt 中的敏感内容。
- 完整剪贴板历史。
- 完整截图内容。
- 完整 stdout/stderr。
- 环境变量完整列表。
- API Key、Token、私钥。

## 14. 禁止策略

默认禁止：

- `del /s`
- `Remove-Item -Recurse`
- `rm -rf`
- 格式化磁盘。
- 修改系统注册表高风险路径。
- 读取整个用户主目录。
- 读取浏览器 profile。
- 读取密码管理器数据。
- 无确认地访问网络。
- 无确认地安装依赖。

注意：禁止策略不能只靠字符串匹配。字符串规则是 MVP 防线，未来还需要结合风险提示、目录沙箱、用户确认和最小权限执行。

## 15. 工作区授权

### 15.1 授权粒度

```json
{
  "scopeId": "workspace:D:\\GoBuddy",
  "path": "D:\\GoBuddy",
  "permissions": ["read"],
  "expiresAt": "session",
  "providerIds": ["codex"],
  "createdAt": "2026-08-02T14:24:31+08:00"
}
```

### 15.2 规则

- 默认不授权任何工作区。
- 用户必须显式选择目录。
- L1 只读可会话记住。
- L2 写入每次确认。
- 不允许把 `C:\Users\<User>` 作为默认授权目录。

## 16. UI 状态设计

AI 面板状态：

| 状态 | UI |
| --- | --- |
| provider_pending | 显示待检测 |
| provider_connected | 显示版本和路径 |
| provider_missing | 显示安装/配置入口 |
| draft_ready | 显示任务草稿 |
| permission_required | 显示确认面板 |
| execution_disabled | MVP 显示后端待接入 |
| running | 显示执行中和取消按钮 |
| completed | 显示结果摘要 |
| failed | 显示错误原因 |

宠物联动：

- provider_missing：Thinking。
- permission_required：Alert。
- running：Working。
- completed：Happy。
- failed：Alert。

## 17. MVP 实现范围

必须实现：

- Provider 列表。
- Provider mock 状态。
- TaskDraft 数据结构。
- 权限确认对象结构。
- `StartTask` 禁用返回。
- AI 面板展示“后端待接入”。

不实现：

- 真实命令执行。
- 真实上下文读取。
- 真实模型请求。
- 文件写入。
- 网络访问。

## 18. 测试用例

### 18.1 单元测试

- L0-L4 风险等级判断。
- 敏感信息打码。
- Provider 状态转换。
- 禁止命令匹配。
- 权限确认对象生成。

### 18.2 集成测试

- Provider 探测超时。
- 未安装 CLI 返回 `not_installed`。
- MVP 执行返回 `execution_disabled_in_mvp`。
- 审计日志不包含原始敏感内容。

### 18.3 手工测试

- AI 面板切换 Provider。
- 生成任务草稿。
- 权限确认弹窗展示字段完整。
- 用户拒绝后任务不执行。
- 关闭 AI 后不影响剪贴板和截图。

## 19. 后续真实执行前置条件

真实 CLI 执行上线前必须完成：

- 系统能力验证 POC-12 通过。
- 权限确认 UI 完成。
- 审计日志完成。
- 敏感信息打码完成。
- 任务取消完成。
- stdout/stderr 限流完成。
- 禁止策略完成。
- 至少覆盖 L0/L1/L2 自动测试。

## 20. 结论

GoBuddy 的 AI/CLI 能力应作为本地优先的安全桥接层，而不是普通聊天框。MVP 阶段只展示入口、Provider、任务草稿和权限模型，坚决不执行真实命令。等系统能力和权限确认成熟后，再逐步开放只读、写入和高级任务能力。
