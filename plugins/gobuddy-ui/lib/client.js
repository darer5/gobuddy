window.__ModuleLoader__.load({
  id: "gobuddy-ui",
  factory: () => {
    const module = { exports: {} };

    function apply(ctx) {
      ctx.effect(() => {
        let disposed = false;
        let startupHandled = false;

        // 启动不恢复上次选择。等 Workspace 基线完成后进入可复用的空白对话；
        // 若用户尚无 Workspace，则透明创建 GoBuddy 的内部对话目录。
        ctx.sessions.clear();
        const enterFreshConversation = async () => {
          const snapshot = ctx.workspaces.list.getSnapshot();
          if (startupHandled || !snapshot.baselinesReady) return;
          startupHandled = true;
          try {
            if (snapshot.items.length > 0) {
              ctx.workspaces.startSession();
              return;
            }
            const workspacePath = await window.goBuddy?.harness?.defaultWorkspace?.();
            if (!workspacePath || disposed) return;
            const workspace = await ctx.workspaces.create({ path: workspacePath });
            if (!disposed) ctx.workspaces.startSession(workspace.workspaceId);
          } catch (error) {
            console.error("[gobuddy-ui] 无法准备新对话：", error);
          }
        };
        const unsubscribe = ctx.workspaces.list.subscribe(enterFreshConversation);
        enterFreshConversation();

        // 保留上游按钮结构，只把产品术语统一为“对话”。
        const localizeNewConversation = () => {
          for (const button of document.querySelectorAll('button[class*="newSession"]')) {
            button.setAttribute("aria-label", "新建对话");
            const label = button.querySelector('[class*="newSessionLabel"]');
            if (label && label.textContent !== "新建对话") label.textContent = "新建对话";
          }
        };
        const observer = new MutationObserver(localizeNewConversation);
        observer.observe(document.body, { childList: true, subtree: true });
        localizeNewConversation();

        return () => {
          disposed = true;
          unsubscribe();
          observer.disconnect();
        };
      }, "gobuddy-ui: fresh conversation");
    }

    module.exports.apply = apply;
    module.exports.inject = ["sessions", "workspaces"];
    return module.exports;
  },
});
