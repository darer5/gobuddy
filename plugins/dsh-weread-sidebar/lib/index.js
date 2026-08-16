/**
 * dsh-weread-sidebar — 微信读书侧边栏（host 半）
 *
 * 为什么需要同站代理：
 *   微信读书（weread.qq.com）的登录 cookie 是 SameSite=Lax。Chromium 98+
 *   之后，跨站 iframe（例如把 weread.qq.com 直接嵌进 http://127.0.0.1:3080
 *   的 Harness 界面）发出的请求不会携带 Lax cookie，因此"iframe 直嵌"无法
 *   完成登录（这是 VSCode 微信读书插件在 Chromium 98 之后同样踩过的坑）。
 *
 *   解决办法：本插件在 127.0.0.1 上再监听一个端口，把 weread.qq.com 的内容
 *   以 http://127.0.0.1:<port>/weread/... 的形式提供给侧边栏 iframe。这样：
 *     - iframe 与 GUI 属于同一个 site（127.0.0.1，端口不影响 site），
 *       SameSite cookie 全部生效 → 扫码登录后登录态、阅读进度都能持久化；
 *     - iframe 的 origin（端口不同）与 GUI 的 origin 不同 → weread 页面上的
 *       脚本永远无法访问 GUI 的数据，安全性等价于普通跨站嵌入。
 *
 * 实现逻辑参照 dsh-better-sidebar 的 host/client 双半结构：
 *   - 本文件 = cordis 插件 host 半（loader 条目 name: dsh-weread-sidebar 的
 *     宿主模块）：启动代理服务器，并在 GUI 同源 webserver 上注册
 *     /weread-proxy.json 配置路由，告诉 client 半代理地址；
 *   - lib/client.js = client 半（browser bundle）：右侧边栏 UI + iframe。
 */
import http from "node:http";
import https from "node:https";
import z from "schemastery";

/** Stable Cordis plugin name. */
const name = "weread-sidebar";

/** Services required before the proxy route can be mounted. */
const inject = ["webServer"];

/** 上游微信读书 origin（唯一允许的代理目标，不做开放代理）。 */
const UPSTREAM_ORIGIN = "https://weread.qq.com";

/** 代理路由前缀（同时是 iframe 的访问前缀，见 lib/client.js）。 */
const PROXY_PREFIX = "/weread";

/** 挂在 GUI 同源 webserver 上的配置路由：client 从这里拿到代理端口。 */
const CONFIG_ROUTE = "/weread-proxy.json";

/** 长连接 agent，避免每个请求都重新做 TLS 握手。 */
const upstreamAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });

/** 插件配置（loader 条目 config 校验；未配置时走默认值）。 */
const Config = z.object({
  /**
   * 代理服务器监听端口；0 表示由操作系统分配空闲端口。默认 3081（GUI 是
   * 3080），被占用时自动退回 0（操作系统分配）。
   */
  port: z.number().step(1).min(0).max(65535).default(3081),
});

/** 需要做文本改写（URL 重写）的响应 content-type。 */
function isTextual(contentType) {
  return /^(text\/html|text\/css|text\/javascript|application\/javascript|application\/x-javascript|application\/json)/i.test(contentType);
}

/**
 * 把响应文本里所有 weread.qq.com 的绝对 URL / 协议相对 URL 改写成代理前缀
 * /weread（相对当前文档解析，落在 http://127.0.0.1:<port>/weread/...）。
 * 用 split/join 而不是正则：语义等价、性能更好、无需转义。
 */
function rewriteText(text) {
  return text
    .split(UPSTREAM_ORIGIN)
    .join(PROXY_PREFIX)
    .split("//weread.qq.com")
    .join(PROXY_PREFIX);
}

/**
 * 清洗上游 Set-Cookie：
 *   - 去掉 Domain（上游可能下发 Domain=qq.com；响应 URL 是 127.0.0.1，
 *     浏览器会因 host 不匹配拒绝该 cookie，登录态就丢了）；
 *   - 去掉 Secure（代理是 http 回环，Secure cookie 在部分场景会被拒收；
 *     去 Secure 不影响 http 场景下的使用）；
 *   - SameSite=None 降为 SameSite=Lax（None 必须搭配 Secure，而我们的
 *     iframe 与 GUI 同站，Lax 即可正常工作）。
 */
function cleanCookie(cookie) {
  return cookie
    .replace(/;\s*Domain=[^;]*/gi, "")
    .replace(/;\s*Secure(?=;|$)/gi, "")
    .replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
}

/**
 * 代理服务器处理器：把浏览器对 /weread/* 的请求转发给 weread.qq.com，
 * 并把响应做 URL 改写 + cookie 清洗后返回。3xx 重定向的 Location 同样改写，
 * 让浏览器在代理域内继续跟随（每一步都由浏览器自己处理 Set-Cookie）。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function proxyHandler(req, res) {
  let url;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const pathname = url.pathname;
  if (pathname !== PROXY_PREFIX && !pathname.startsWith(PROXY_PREFIX + "/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const upstreamPath = pathname === PROXY_PREFIX ? "/" : pathname.slice(PROXY_PREFIX.length);
  const upstreamUrl = `${UPSTREAM_ORIGIN}${upstreamPath}${url.search}`;

  const headers = {
    "accept-encoding": "identity",
    ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
    ...(req.headers["user-agent"] ? { "user-agent": req.headers["user-agent"] } : {}),
    ...(req.headers.accept ? { accept: req.headers.accept } : {}),
    ...(req.headers["accept-language"] ? { "accept-language": req.headers["accept-language"] } : {}),
    ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
    ...(req.headers["content-length"] ? { "content-length": req.headers["content-length"] } : {}),
  };

  const upstream = https.request(upstreamUrl, {
    method: req.method ?? "GET",
    headers,
    agent: upstreamAgent,
  }, (up) => {
    const status = up.statusCode ?? 502;
    const setCookies = Array.isArray(up.headers["set-cookie"]) ? up.headers["set-cookie"] : [];
    const chunks = [];
    up.on("data", (chunk) => chunks.push(chunk));
    up.on("end", () => {
      let body = Buffer.concat(chunks);
      const contentType = String(up.headers["content-type"] ?? "");
      if (isTextual(contentType)) {
        body = Buffer.from(rewriteText(body.toString("utf8")), "utf8");
      }
      const outHeaders = {
        "content-type": contentType,
        "cache-control": String(up.headers["cache-control"] ?? "no-cache"),
        "x-weread-proxy": name,
        ...(status >= 300 && status < 400 && up.headers.location
          ? { location: rewriteText(String(up.headers.location)) }
          : {}),
        ...(setCookies.length > 0 ? { "set-cookie": setCookies.map(cleanCookie) } : {}),
        "content-length": String(body.length),
      };
      if (!res.headersSent) {
        res.writeHead(status, outHeaders);
        res.end(body);
      } else {
        res.end();
      }
    });
    up.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("dsh-weread-sidebar: upstream error");
      } else {
        res.end();
      }
    });
  });
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("dsh-weread-sidebar: cannot reach weread.qq.com");
    }
  });
  req.pipe(upstream);
}

/**
 * 插件主体：启动代理服务器，并在 GUI 同源 webserver 上注册配置路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis 上下文（含 webServer 服务）。
 * @param {{ port: number }} config - 插件配置。
 */
function apply(ctx, config) {
  let proxyOrigin = null;
  const server = http.createServer(proxyHandler);

  ctx.effect(() => {
    const tryListen = (port) => {
      server.listen({ host: "127.0.0.1", port });
    };
    server.on("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : config.port;
      proxyOrigin = `http://127.0.0.1:${String(port)}`;
      ctx.logger?.info?.(`[dsh-weread-sidebar] weread proxy listening at ${proxyOrigin}`);
    });
    server.on("error", (error) => {
      // 默认端口被占用时自动退回操作系统分配，避免插件启动失败。
      if (error && error.code === "EADDRINUSE" && config.port !== 0) {
        try { server.close(); } catch { /* already closed */ }
        tryListen(0);
      } else {
        ctx.logger?.warn?.(`[dsh-weread-sidebar] proxy server error: ${String(error.message ?? error)}`);
      }
    });
    tryListen(config.port);
    return () => {
      server.close();
      proxyOrigin = null;
    };
  }, "dsh-weread-sidebar: proxy server");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: CONFIG_ROUTE,
    handler: (_req, res) => {
      const body = JSON.stringify(proxyOrigin === null
        ? { ready: false }
        : { ready: true, origin: proxyOrigin, url: `${proxyOrigin}${PROXY_PREFIX}/` });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
    },
  }), "dsh-weread-sidebar: proxy config route");
}

export { Config, apply, inject, name };
