# dsh-weread-sidebar — 微信读书侧边栏

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 客户端插件：
在 Harness Web 界面（`http://127.0.0.1:3080`）的右侧打开**微信读书网页版**侧边栏。
Harness 跑任务时打开它看一会儿书，任务完成后再切回来继续，两边互不干扰。

实现逻辑参考 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)：
bundle patch 插入 loader 条目 + `dsh.client` 声明 + 单文件 client bundle + portal 挂载 + `#root` 布局让位。

## 为什么不是直接 iframe 微信读书？

微信读书的登录 cookie 是 `SameSite=Lax`。Chromium 98 之后，**跨站 iframe**
（把 `weread.qq.com` 直接嵌进 `127.0.0.1:3080` 的页面）发出的请求不会携带
Lax cookie，扫码登录无法完成（VSCode 的微信读书插件同样栽在这上面）。

所以本插件在 `127.0.0.1` 上额外开一个**同站代理端口**（默认 3081），把
`weread.qq.com` 的内容以 `http://127.0.0.1:<port>/weread/...` 提供：

- iframe 与 GUI 同 site（都是 `127.0.0.1`）→ SameSite cookie 全部生效，
  **扫码登录后登录态、阅读进度都能持久化**；
- iframe 与 GUI 不同 origin（端口不同）→ weread 页面上的脚本永远碰不到
  GUI 的数据，安全性等价于普通跨站嵌入。

## 功能

- 右上角「读书」按钮 → 右侧展开微信读书面板（面板打开时主对话区自动让位，不遮挡）；
- 首次使用：在面板里用微信扫码登录，之后每次打开都是已登录状态；
- 面板保留挂载：收起再展开，当前页面 / 阅读位置不丢失；
- 左边缘可拖拽调整面板宽度（300–720px），开关状态与宽度持久化；
- 刷新 / 在浏览器打开 / 收起 三个面板操作按钮。

## 安装

### 方式一：官方 CLI（推荐，需要已发布的 npm 包）

```bash
dsh plugin --profile web add dsh-weread-sidebar@<version>
```

### 方式二：手动安装到现有 web profile（本仓库 GoBuddy 场景）

1. 把本包放进 profile 的 node_modules：

   ```powershell
   $profile = "$env:APPDATA\GoBuddy\HarnessHomeManaged\profiles\web"
   Copy-Item -Recurse D:\GoBuddy\plugins\dsh-weread-sidebar "$profile\node_modules\dsh-weread-sidebar"
   ```

2. 编辑 `$profile\package.json`：
   - `dependencies` 增加 `"dsh-weread-sidebar": "0.1.0"`；
   - `dsh.profile.bundles` 数组末尾追加 `"dsh-weread-sidebar"`。

3. **重启 Harness**（plugin-set 变化需要重启才生效）：在 GoBuddy 设置里停止再
   启动 Harness，或直接重启 GoBuddy。

### 方式三：作为 GoBuddy 预设插件随构建打包

在 `D:\GoBuddy\scripts\harness-runtime-utils.mjs` 的 `PRESET_PLUGINS` 中加入：

```js
"dsh-weread-sidebar": "file:plugins/dsh-weread-sidebar",
```

`npm run prepare:harness-runtime` 会把它安装进打包用的 runtime，
GoBuddy 首次启动时会自动把预设插件追加到 web profile 的 bundles 列表。

## 结构

```
dsh-weread-sidebar/
├── package.json        # dsh.bundle.patch + dsh.client 声明，exports["./client"]
├── cordis.patch.yml    # 把本插件作为一行 loader 条目插入插件树
├── lib/
│   ├── index.js        # host 半：同站代理服务器 + /weread-proxy.json 配置路由
│   └── client.js       # client 半：右侧边栏 UI + iframe（单文件 bundle，无构建步骤）
└── README.md
```

## 验证

重启后检查：

- `http://127.0.0.1:3080/` 的 `window.__DSH_BOOT__` 包含 `dsh-weread-sidebar`；
- `http://127.0.0.1:3080/plugins/dsh-weread-sidebar/client.js` 返回 bundle；
- `http://127.0.0.1:3080/weread-proxy.json` 返回 `{"ready":true,"origin":"http://127.0.0.1:3081",...}`；
- `http://127.0.0.1:3081/weread/` 能打开微信读书首页（HTML 中 URL 已改写为 `/weread/...`）。

## 已知限制

- 与 dsh-better-sidebar 同开时，两者都会推动 `#root` 的 margin-right，
  本插件打开时优先（后注入的样式规则在 body 属性选择器下胜出）；建议同时只开一个。
- 微信读书网页版偶尔改版可能导致个别资源跨域加载异常，刷新即可。
- 代理仅在本地回环监听，不做开放代理。

## License

MIT
