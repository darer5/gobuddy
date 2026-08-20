const name = "web-canvas";
const inject = ["tools"];

function output(description) {
  return {
    schema: { type: "string", description },
    render: (_args, value) => [{ type: "text", text: value }],
    presentationMeta: () => ({ title: description }),
  };
}

function bridge(path, options = {}) {
  const base = process.env.GOBUDDY_WEB_CANVAS_BRIDGE_URL;
  const token = process.env.GOBUDDY_WEB_CANVAS_BRIDGE_TOKEN;
  if (!base || !token) throw new Error("Web Canvas 仅可在 GoBuddy Desktop 中使用。");
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Web Canvas bridge ${response.status}`);
    return body;
  });
}

function apply(ctx) {
  ctx.tools.register({
    name: "web_get_current_context",
    description: "获取用户当前在 GoBuddy Web Canvas 中浏览的网页、实体、选区与视口上下文。用户提到“这个网页、这里、当前股票”时优先调用。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: output("当前网页上下文 JSON"),
    execute: async () => JSON.stringify(await bridge("/context"), null, 2),
  });
  ctx.tools.register({
    name: "web_get_annotations",
    description: "获取当前 Web Canvas 页面上用户创建的高亮、框选、文字和问题标注。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: output("当前页面标注 JSON"),
    execute: async () => JSON.stringify(await bridge("/annotations"), null, 2),
  });
  ctx.tools.register({
    name: "web_get_recent_contexts",
    description: "获取最近浏览的网页上下文，用于理解“刚才那个”和跨页面比较。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: output("最近网页上下文 JSON"),
    execute: async () => JSON.stringify(await bridge("/recent-contexts"), null, 2),
  });
  ctx.tools.register({
    name: "web_capture_viewport",
    description: "截取用户当前可见的 Web Canvas 视口，返回本地图片路径与尺寸。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: output("网页视口截图信息 JSON"),
    execute: async () => JSON.stringify(await bridge("/capture", { method: "POST", body: "{}" }), null, 2),
  });
  ctx.tools.register({
    name: "web_navigate",
    description: "让 GoBuddy Web Canvas 导航到指定 HTTP/HTTPS 地址。",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "要打开的完整网页地址" } },
      required: ["url"],
      additionalProperties: false,
    },
    output: output("导航后的 Web Canvas 状态 JSON"),
    execute: async (args) => JSON.stringify(await bridge("/navigate", { method: "POST", body: JSON.stringify({ url: args.url }) }), null, 2),
  });
  ctx.tools.register({
    name: "web_focus_annotation",
    description: "在当前网页中闪烁定位指定标注。",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "标注 ID" } },
      required: ["id"],
      additionalProperties: false,
    },
    output: output("定位结果 JSON"),
    execute: async (args) => JSON.stringify(await bridge("/focus", { method: "POST", body: JSON.stringify({ id: args.id }) }), null, 2),
  });
}

export { apply, inject, name };
