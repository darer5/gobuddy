const modifierMap = new Map([
  ["CTRL", "CommandOrControl"],
  ["CONTROL", "CommandOrControl"],
  ["CMD", "Command"],
  ["COMMAND", "Command"],
  ["SHIFT", "Shift"],
  ["ALT", "Alt"],
  ["OPTION", "Alt"],
  ["META", "Super"],
  ["WIN", "Super"],
]);

const keyAliases = new Map([
  ["ESC", "Esc"],
  ["ESCAPE", "Esc"],
  ["SPACE", "Space"],
  ["PLUS", "Plus"],
]);

export function normalizeAccelerator(input) {
  if (!input || typeof input !== "string") {
    throw new Error("快捷键不能为空。");
  }

  const parts = input
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    throw new Error("快捷键至少需要一个修饰键和一个按键。");
  }

  const modifiers = [];
  let key = "";
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (modifierMap.has(upper)) {
      const modifier = modifierMap.get(upper);
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier);
      }
    } else {
      key = keyAliases.get(upper) ?? part.toUpperCase();
    }
  }

  if (modifiers.length === 0 || !key) {
    throw new Error("快捷键格式不正确。");
  }

  return [...modifiers, key].join("+");
}

export function validateHotkeySet(hotkeys) {
  const screenshot = normalizeAccelerator(hotkeys.screenshot);
  const clipboardHistory = normalizeAccelerator(hotkeys.clipboardHistory);
  if (screenshot === clipboardHistory) {
    throw new Error("截图和粘贴历史快捷键不能相同。");
  }

  return { screenshot, clipboardHistory };
}

export function registerGlobalHotkeys(globalShortcut, hotkeys, callbacks, logEvent) {
  globalShortcut.unregisterAll();
  const normalized = validateHotkeySet(hotkeys);
  const results = {};

  for (const [name, accelerator] of Object.entries(normalized)) {
    const registered = globalShortcut.register(accelerator, callbacks[name]);
    results[name] = { accelerator, registered };
    if (!registered) {
      logEvent?.("hotkey.register.failed", false, `${accelerator} 注册失败`);
    }
  }

  return results;
}
