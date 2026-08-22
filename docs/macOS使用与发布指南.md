# GoBuddy macOS(Intel)使用与发布指南

本文档面向在 **Intel 芯片 Mac(macOS 12+)** 上安装/构建 GoBuddy,以及把新版本发布到 GitHub Release 的完整流程。

> 系统要求:Intel x64 Mac,macOS 12 (Monterey) 或更新(Electron 37 的最低要求)。

---

## 一、方式 A:直接安装 DMG(推荐)

1. 打开 GitHub 仓库的 **Releases** 页面(如 `https://github.com/darer5/gobuddy/releases`)。
2. 找到最新版本(如 `v0.3.0`),下载 **`GoBuddy-0.3.0-mac-x64.dmg`**。
3. 双击 DMG 挂载,把 **GoBuddy.app** 拖入「应用程序」文件夹。
4. **首次打开(未签名应用)**:由于没有 Apple Developer 签名,Gatekeeper 会拦截。任选一种方式放行:
   - 在 Finder 中右键 GoBuddy.app → 选择「**打开**」→ 再次点击「打开」;或
   - 终端执行:
     ```bash
     xattr -cr /Applications/GoBuddy.app
     ```
5. 授予系统权限(截图与全局快捷键需要):
   - 系统设置 → 隐私与安全性 → **屏幕录制** → 勾选 GoBuddy;
   - 系统设置 → 隐私与安全性 → **辅助功能** → 勾选 GoBuddy;
   - 设置完成后完全退出并重新打开 GoBuddy。
6. 打开 GoBuddy 设置,填入 **DeepSeek API Key**(及可选的自定义 Base URL),保存后 Harness 客户端会自动加载(`http://127.0.0.1:3080`),即可开始对话、截图等。

> 提示:GitHub 会自动为每个 tag 生成源代码 zip/tar.gz(见 Release 页「Source code」),想自己改代码就下载那个。

---

## 二、方式 B:从源码构建(想在 Mac 上自己编译)

前提:Mac 上已安装 **Node.js 20/22 LTS**(自带 npm)。

```bash
# 1. 获取源码(Release 页的 Source code 压缩包,或 git clone)
git clone git@github.com:darer5/gobuddy.git
cd gobuddy

# 2. 安装依赖
npm ci

# 3. 准备运行时资产(Harness 运行时 + darwin-x64 版 node)
#    无本地 GoBuddy 安装时,prepare 脚本会自动从 npm 引导安装完整运行时
npm run prepare:runtime-assets

# 4a. 开发模式运行(热更新)
npm start

# 4b. 或生成 DMG 安装包
npm run dist:mac
# 产物:release/GoBuddy-<版本>-mac-x64.dmg
```

注意事项:

- `prepare:runtime-assets` 会在 **Mac 上**重新生成 `vendor/`(该目录已被 .gitignore 忽略,不随源码发布):Harness 运行时按当前平台安装原生预编译(darwin-x64 的 node-pty/sharp/koffi/ripgrep),Node 运行时使用兼容 macOS 12 的 Node.js 22 官方发行归档并校验 SHA-256。不要用 Homebrew 的 `bin/node` 直接打包，它依赖未随包分发的动态库。
- **不要**把 Windows 机器上的 `vendor/` 拷到 Mac 用——里面的 `node.exe` 和 Windows 原生模块在 Mac 上无法运行。
- 若你已有另一台机器装过 GoBuddy,可通过环境变量直接复用它的运行时目录,跳过联网安装:
  ```bash
  GOBUDDY_HARNESS_RUNTIME="/path/to/HarnessRuntimeManaged" npm run prepare:runtime-assets
  ```

---

## 三、发布新版本到 GitHub Release(全自动)

仓库已配置 GitHub Actions(`.github/workflows/release-mac.yml`),推 tag 后自动在 **Intel macOS 构建机** 上构建 DMG 并上传:

```bash
# 1. 修改 package.json 版本号(如 0.3.0 → 0.3.1),提交
git add -A
git commit -m "Release 0.3.1"

# 2. 推代码 + 打 tag 并推送(触发 CI)
git push origin main
git tag v0.3.1
git push origin v0.3.1
```

- 打开 GitHub 仓库 → **Actions** 页,等待 `Release Intel macOS DMG` 工作流成功(约 10 分钟)。
- 成功后 **Releases** 页自动出现 `v0.3.1`,包含:
  - `GoBuddy-0.3.1-mac-x64.dmg`(Intel Mac 安装包);
  - `Source code (zip/tar.gz)`(GitHub 自动生成)。
- 也可以不推 tag,在 Actions 页手动运行 `workflow_dispatch` 触发构建,DMG 会上传到以当前版本号命名的 Release。

**Windows 安装包**:仍按原流程本地执行 `npm run dist:win` 后手动上传,或后续扩展 workflow 增加 Windows 构建 job。

**关于 macOS 构建配额**:公开仓库每月有免费构建分钟额度(macOS 按 10 倍折算,约合每月 200 分钟 macOS 构建时间),个人发布频率完全够用。

---

## 四、常见问题

| 问题 | 解决办法 |
| --- | --- |
| 「无法打开,因为无法验证开发者」 | 右键 → 打开;或 `xattr -cr /Applications/GoBuddy.app` |
| 截图/全局快捷键无反应 | 检查「屏幕录制」「辅助功能」权限,改完后完全退出重启应用 |
| 打开后一直停留在「正在启动 DeepSeek Harness...」 | 检查网络能否访问 npm registry;首次启动会引导/校验运行时,稍等;或查看 `~/Library/Application Support/GoBuddy/gobuddy-main.log` |
| AI 对话报鉴权错误 | 设置里检查 DeepSeek API Key 与 Base URL |
| 想卸载 | 把 GoBuddy.app 拖入废纸篓,并删除 `~/Library/Application Support/GoBuddy` |

---

## 五、安全与隐私说明

- 未签名 DMG 仅影响 Gatekeeper 首次拦截,不影响功能;若要免弹窗安装,需要 Apple Developer 账号签名 + 公证,后续可再配置。
- 应用数据(设置、数据库、截图、Harness 会话)保存在 `~/Library/Application Support/GoBuddy`。
- Harness 运行时由 `@deepseek-ai/*` npm 包构成,构建时按平台安装;API Key 只保存在本机设置文件中,用于调用 DeepSeek API。
