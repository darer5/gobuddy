import crypto from "node:crypto";

export class ChatAgentService {
  constructor({ database, knowledgeService, harnessRuntime, sendEvent }) {
    this.database = database;
    this.knowledgeService = knowledgeService;
    this.harnessRuntime = harnessRuntime;
    this.sendEvent = sendEvent;
  }

  listSessions() {
    return this.database.listChatSessions();
  }

  listMessages(sessionId) {
    return this.database.listChatMessages(sessionId);
  }

  async sendMessage({ sessionId, text }) {
    const prompt = String(text ?? "").trim();
    if (!prompt) {
      throw new Error("消息不能为空。");
    }

    const session = this.ensureSession(sessionId, prompt);
    const userMessage = this.database.addChatMessage({
      sessionId: session.id,
      role: "user",
      content: prompt,
    });
    this.emit("chat:message", userMessage);
    this.emit("chat:status", { state: "thinking", message: "正在检索 GoBuddy 知识库..." });

    const result = await this.runLocalKnowledgeAgent(prompt);
    const assistantMessage = this.database.addChatMessage({
      sessionId: session.id,
      role: "assistant",
      content: result.content,
      references: result.references,
      toolEvents: result.toolEvents,
    });
    this.emit("chat:toolCall", result.toolEvents[0]);
    this.emit("chat:toolResult", { references: result.references });
    this.emit("chat:message", assistantMessage);
    this.emit("chat:status", this.harnessRuntime.getStatus());

    return {
      session: this.database.findChatSession(session.id),
      userMessage,
      assistantMessage,
    };
  }

  stop() {
    return this.harnessRuntime.stop();
  }

  ensureSession(sessionId, prompt) {
    if (sessionId) {
      const existing = this.database.findChatSession(sessionId);
      if (existing) {
        return existing;
      }
    }

    return this.database.createChatSession({
      id: sessionId || crypto.randomUUID(),
      title: titleFromPrompt(prompt),
    });
  }

  async runLocalKnowledgeAgent(prompt) {
    const intent = inferIntent(prompt);
    const query = extractQuery(prompt, intent);
    const references = this.knowledgeService.search({
      query,
      type: intent.type,
      limit: 6,
    });
    const toolEvent = {
      id: crypto.randomUUID(),
      name: "gobuddy.search_knowledge",
      args: { query, type: intent.type, limit: 6 },
      createdAt: new Date().toISOString(),
    };

    if (intent.needsUpdate && references[0]) {
      const action = this.knowledgeService.proposeUpdate(
        references[0].id,
        { tags: intent.tags, note: intent.note },
        "用户通过对话请求整理知识条目。",
      );
      return {
        content: `我找到了最相关的条目，并生成了一个需要你确认的整理操作：${describeKnowledge(references[0])}\n\n待确认操作：${action.reason}`,
        references,
        toolEvents: [
          toolEvent,
          { id: action.id, name: "gobuddy.propose_update_knowledge_item", args: action, createdAt: action.createdAt },
        ],
      };
    }

    if (references.length === 0) {
      return {
        content: `我没有在当前剪贴板和截图知识库里找到与“${query || prompt}”相关的内容。\n\n你可以先复制一段文本、链接，或截一张图，然后再问我帮你整理。`,
        references: [],
        toolEvents: [toolEvent],
      };
    }

    return {
      content: buildAnswer(prompt, references),
      references,
      toolEvents: [toolEvent],
    };
  }

  emit(event, payload) {
    this.sendEvent?.(event, payload);
  }
}

function inferIntent(prompt) {
  const lower = prompt.toLowerCase();
  const type = /截图|截屏|screenshot/.test(prompt) ? "screenshot"
    : /链接|网址|url|http/.test(lower) ? "link"
      : /图片|image/.test(prompt) ? "image"
        : /剪贴板|复制|clipboard/.test(lower) ? "clipboard"
          : "all";

  const needsUpdate = /标记|标签|整理|备注|归类|固定/.test(prompt);
  const tags = [];
  const tagMatch = prompt.match(/(?:标记为|标签为|归类为)([^，。,.]+)/);
  if (tagMatch?.[1]) {
    tags.push(tagMatch[1].trim());
  }

  return {
    type,
    needsUpdate,
    tags,
    note: needsUpdate ? prompt.slice(0, 200) : "",
  };
}

function extractQuery(prompt, intent) {
  const cleaned = prompt
    .replace(/帮我|请|查找|找一下|找|最近|复制的|剪贴板|截图|链接|内容|有哪些|是什么/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length >= 2 && !intent.needsUpdate) {
    return cleaned;
  }
  return "";
}

function buildAnswer(prompt, references) {
  const lines = references.map((item, index) => `${index + 1}. ${describeKnowledge(item)}`);
  return `我在 GoBuddy 知识库里找到了 ${references.length} 条相关内容：\n\n${lines.join("\n")}\n\n你可以继续让我打开、复制、总结，或给其中某条加标签。`;
}

function describeKnowledge(item) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(item.createdAt));
  const note = item.note ? `，备注：${item.note}` : "";
  const tags = item.tags?.length ? `，标签：${item.tags.join("、")}` : "";
  return `[${labelForType(item.type)}] ${item.title || item.content.slice(0, 40)}（${time}${note}${tags}）`;
}

function labelForType(type) {
  return {
    text: "文本",
    link: "链接",
    image: "图片",
    screenshot: "截图",
  }[type] ?? "知识";
}

function titleFromPrompt(prompt) {
  return prompt.length > 24 ? `${prompt.slice(0, 24)}...` : prompt;
}
