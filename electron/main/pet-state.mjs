export const petModes = [
  "idle",
  "blink",
  "look",
  "poke",
  "drag",
  "sleep",
  "clipboard-text",
  "clipboard-link",
  "clipboard-image",
  "screenshot-start",
  "screenshot-success",
  "screenshot-cancel",
  "main-open",
];

const actionProfiles = {
  idle: {
    expression: "calm",
    animation: "breathe",
    priority: 0,
    durationMs: 0,
    layer: "ambient",
    message: "我在这里。",
  },
  blink: {
    expression: "blink",
    animation: "blink",
    priority: 0,
    durationMs: 1000,
    layer: "ambient",
    message: "眨眨眼，继续陪你。",
  },
  look: {
    expression: "curious",
    animation: "look",
    priority: 0,
    durationMs: 1800,
    layer: "ambient",
    message: "我看看旁边发生了什么。",
  },
  poke: {
    expression: "happy",
    animation: "bounce",
    priority: 2,
    durationMs: 1600,
    layer: "interaction",
    message: "嘿，我在。",
  },
  drag: {
    expression: "focused",
    animation: "drag",
    priority: 4,
    durationMs: 0,
    layer: "interaction",
    message: "正在移动位置。",
  },
  sleep: {
    expression: "sleepy",
    animation: "sleep",
    priority: 1,
    durationMs: 0,
    layer: "ambient",
    message: "我先安静待命。",
  },
  "clipboard-text": {
    expression: "focused",
    animation: "nod",
    priority: 2,
    durationMs: 2200,
    layer: "work",
    message: "剪贴板收到了新文本。",
  },
  "clipboard-link": {
    expression: "curious",
    animation: "look",
    priority: 2,
    durationMs: 2200,
    layer: "work",
    message: "这个链接我帮你记下了。",
  },
  "clipboard-image": {
    expression: "happy",
    animation: "pop",
    priority: 2,
    durationMs: 2400,
    layer: "work",
    message: "图片已收进剪贴板历史。",
  },
  "screenshot-start": {
    expression: "focused",
    animation: "focus",
    priority: 3,
    durationMs: 2600,
    layer: "work",
    message: "截图选择框已打开。",
  },
  "screenshot-success": {
    expression: "proud",
    animation: "sparkle",
    priority: 4,
    durationMs: 2800,
    layer: "work",
    message: "截图已保存并复制到剪贴板。",
  },
  "screenshot-cancel": {
    expression: "calm",
    animation: "breathe",
    priority: 2,
    durationMs: 1400,
    layer: "work",
    message: "已取消截图。",
  },
  "main-open": {
    expression: "happy",
    animation: "jump",
    priority: 4,
    durationMs: 1800,
    layer: "interaction",
    message: "主页面已打开。",
  },
};

const modeAliases = {
  clipboard: "clipboard-text",
  screenshot: "screenshot-success",
  notify: "clipboard-text",
  walk: "look",
  happy: "poke",
  curious: "look",
};

export class PetStateMachine {
  constructor() {
    this.mode = "idle";
    this.profile = actionProfiles.idle;
    this.message = this.profile.message;
    this.updatedAt = Date.now();
  }

  setMode(mode, message = "") {
    const resolvedMode = resolvePetMode(mode);
    if (!petModes.includes(resolvedMode)) {
      throw new Error(`未知宠物动作：${mode}`);
    }

    const profile = actionProfiles[resolvedMode];
    this.mode = resolvedMode;
    this.profile = profile;
    this.message = message || profile.message;
    this.updatedAt = Date.now();
    return this.snapshot();
  }

  tick(now = Date.now()) {
    if (this.profile.durationMs > 0 && now - this.updatedAt > this.profile.durationMs) {
      return this.setMode("idle");
    }

    if (this.mode === "idle" && now - this.updatedAt > 7000) {
      const ambient = chooseAmbientAction(now);
      if (ambient) {
        return this.setMode(ambient);
      }
    }

    return this.snapshot();
  }

  canInterruptWith(mode) {
    const next = actionProfiles[resolvePetMode(mode)];
    if (!next) {
      return false;
    }

    return next.priority >= this.profile.priority;
  }

  snapshot() {
    return {
      mode: this.mode,
      expression: this.profile.expression,
      animation: this.profile.animation,
      priority: this.profile.priority,
      layer: this.profile.layer,
      message: this.message,
      updatedAt: this.updatedAt,
    };
  }
}

export function getPetActionProfile(mode) {
  return actionProfiles[resolvePetMode(mode)];
}

export function resolvePetMode(mode) {
  return modeAliases[mode] ?? mode;
}

function chooseAmbientAction(now) {
  const bucket = Math.floor(now / 1000) % 8;
  if (bucket === 0) return "blink";
  if (bucket === 3) return "look";
  return "";
}
