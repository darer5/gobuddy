# GoBuddy Electron

GoBuddy 现在是纯 Electron 桌面应用。Electron Main 负责窗口、托盘、全局快捷键、截图、SQLite 和 IPC；React/Vite Renderer 负责 Codex 风格主界面、对话工作台和设置。

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

当前测试覆盖快捷键解析、设置合并、SQLite CRUD 和知识服务。

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

