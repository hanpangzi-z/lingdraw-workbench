import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isHostAuthFailure, isPptHostResponseUrl, PPT_BASE_PATH, withBasePath } from "@/src/lib/basePath";
import { identityFromHeaders, isTrustedProxyToken, shadowEmail } from "@/src/server/auth/proxyIdentity";
import { LingDrawAIProvider } from "@/src/lib/ai/providers/lingdraw";
import { fieldDetectionSchema } from "@/src/lib/ai/schemas";
import { assertLingDrawImageReservation, extractLingDrawImage, imageExtension } from "@/src/lib/ai/imageGeneration";
import { bridgeError, settleLingDrawImage, settleLingDrawImageWithRetry } from "@/src/server/ai/internalBridge";
import { resolvePptLocalizedValue, translatePptText } from "@/src/lib/pptI18n";
import { listenForPptActivation, PPT_ACTIVATE_EVENT } from "@/src/lib/hostEvents";
import { generateProductImage, PRODUCT_IMAGE_GENERATION_TIMEOUT_MS } from "@/src/lib/ai/generateProductImageClient";
import { loadImageModelOptions } from "@/src/lib/ai/imageModelOptions";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.PPT_INTERNAL_TOKEN;
  delete process.env.PPT_INTERNAL_URL;
});

describe("LingDraw PPT integration contract", () => {
  it("adds the PPT base path exactly once", () => {
    expect(PPT_BASE_PATH).toBe("/ppt");
    expect(withBasePath("/projects")).toBe("/ppt/projects");
    expect(withBasePath("/api/projects?id=1")).toBe("/ppt/api/projects?id=1");
    expect(withBasePath("/ppt/api/projects")).toBe("/ppt/api/projects");
    expect(withBasePath("https://example.com/image.png")).toBe("https://example.com/image.png");
    expect(withBasePath("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("notifies the host only for session and account-state authorization failures", async () => {
    await expect(isHostAuthFailure(Response.json({}, { status: 401 }))).resolves.toBe(true);
    await expect(isHostAuthFailure(Response.json({ code: "account_disabled" }, { status: 403 }))).resolves.toBe(true);
    await expect(isHostAuthFailure(Response.json({ detail: { code: "account_pending" } }, { status: 403 }))).resolves.toBe(true);
    await expect(isHostAuthFailure(Response.json({ code: "FORBIDDEN" }, { status: 403 }))).resolves.toBe(false);
    await expect(isHostAuthFailure(new Response("not-json", { status: 403 }))).resolves.toBe(false);
    expect(isPptHostResponseUrl("https://lingdraw.test/ppt/api/projects", "https://lingdraw.test")).toBe(true);
    expect(isPptHostResponseUrl("https://images.example/private.jpg", "https://lingdraw.test")).toBe(false);
    const external = new Response(null, { status: 401 });
    Object.defineProperty(external, "url", { value: "https://images.example/private.jpg" });
    await expect(isHostAuthFailure(external, "https://lingdraw.test")).resolves.toBe(false);
  });

  it("configures Next standalone output under /ppt", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain('basePath: "/ppt"');
    expect(config).toContain('output: "standalone"');
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("PORT=37623");
    expect(dockerfile).toContain("EXPOSE 37623");
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends openssl");
  });

  it("accepts only the configured internal proxy token and decodes identity headers", () => {
    process.env.PPT_INTERNAL_TOKEN = "correct-horse-battery-staple";
    expect(isTrustedProxyToken("wrong")).toBe(false);
    expect(isTrustedProxyToken("correct-horse-battery-staple")).toBe(true);
    const headers = new Headers({
      "x-ppt-internal-token": "correct-horse-battery-staple",
      "x-lingdraw-user-id": "user-42",
      "x-lingdraw-username": encodeURIComponent("王小明@example.com"),
      "x-lingdraw-display-name": encodeURIComponent("王小明"),
      "x-lingdraw-role": "admin",
    });
    expect(identityFromHeaders(headers)).toEqual({ externalUserId: "user-42", username: "王小明@example.com", displayName: "王小明", role: "admin" });
  });

  it("rejects missing or forged proxy identity headers", () => {
    process.env.PPT_INTERNAL_TOKEN = "server-secret";
    expect(identityFromHeaders(new Headers())).toBeUndefined();
    expect(identityFromHeaders(new Headers({
      "x-ppt-internal-token": "client-forgery",
      "x-lingdraw-user-id": "victim",
      "x-lingdraw-username": "victim@example.com",
    }))).toBeUndefined();
  });

  it("uses a deterministic non-routable email for non-email usernames", () => {
    const first = shadowEmail({ externalUserId: "uid-1", username: "张三" });
    expect(first).toBe(shadowEmail({ externalUserId: "uid-1", username: "张三" }));
    expect(first).toMatch(/^lingdraw-[a-f0-9]{32}@internal\.invalid$/);
  });

  it("sends structured chat requests only through the LingDraw internal bridge", async () => {
    process.env.PPT_INTERNAL_TOKEN = "bridge-secret";
    process.env.PPT_INTERNAL_URL = "http://lingdraw:37621/";
    const data = { mappings: [{ targetField: "name", sourceColumn: "商品名", confidence: 0.99, reason: "语义匹配" }] };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data, provider: "configured-provider", model: "configured-model", usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LingDrawAIProvider({ id: "shadow", externalUserId: "uid-1", username: "user@example.com", email: "user@example.com", name: "用户", avatarUrl: null, role: "user" }, "field-detection");
    await expect(provider.generateStructuredData("system", "user", fieldDetectionSchema)).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("http://lingdraw:37621/api/ppt/internal/ai/chat");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: expect.objectContaining({ "x-ppt-internal-token": "bridge-secret", "x-lingdraw-user-id": "uid-1" }) });
    expect(provider.getLastUsage()).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20, estimated: false });
  });

  it("rejects a chat bridge response that violates the requested schema", async () => {
    process.env.PPT_INTERNAL_TOKEN = "bridge-secret";
    process.env.PPT_INTERNAL_URL = "http://lingdraw:37621";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { mappings: [{ sourceColumn: 123 }] } })));
    const provider = new LingDrawAIProvider({ id: "shadow", externalUserId: "uid-1", username: "user", email: "user@internal.invalid", name: null, avatarUrl: null, role: "user" }, "field-detection");
    await expect(provider.generateStructuredData("system", "user", fieldDetectionSchema)).rejects.toThrow("运行时校验");
  });

  it("never exposes raw internal AI failures to the browser", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const message = await bridgeError(Response.json({ detail: "C:\\private\\provider-cli.exe failed with secret" }, { status: 500 }));
    expect(message).toBe("灵绘 AI 服务暂时不可用（HTTP 500）");
    expect(message).not.toContain("provider-cli");
    expect(warning).toHaveBeenCalledWith("[LingDraw AI] upstream request failed", { status: 500 });
    warning.mockRestore();
  });

  it("forwards a caller-provided idempotency key to the chat bridge", async () => {
    process.env.PPT_INTERNAL_TOKEN = "bridge-secret";
    process.env.PPT_INTERNAL_URL = "http://lingdraw:37621";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: { mappings: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new LingDrawAIProvider({ id: "shadow", externalUserId: "uid-1", username: "user", email: "user@internal.invalid", name: null, avatarUrl: null, role: "user" }, "field-detection", "logical-batch-1");
    await provider.generateStructuredData("system", "user", fieldDetectionSchema);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ request_id: "logical-batch-1" });
  });

  it("validates the image bridge wire shape", () => {
    expect(extractLingDrawImage({ image: { base64: "YWJj", mimeType: "image/webp" } })).toEqual({ base64: "YWJj", mimeType: "image/webp" });
    expect(() => extractLingDrawImage({ image: { base64: "YWJj", mimeType: "application/json" } })).toThrow();
    expect(() => extractLingDrawImage({ image: { base64: "not base64", mimeType: "image/png" } })).toThrow();
    expect(() => extractLingDrawImage({ image: { base64: "YWJj", mimeType: "image/svg+xml" } })).toThrow();
    expect(extractLingDrawImage({ image: { base64: "YWJj", mimeType: "image/gif" } })).toEqual({ base64: "YWJj", mimeType: "image/gif" });
    expect(imageExtension("image/gif")).toBe("gif");
    expect(() => assertLingDrawImageReservation({ requestId: "image-1", billingStatus: "reserved" }, "image-1")).not.toThrow();
    expect(() => assertLingDrawImageReservation({ requestId: "image-1" }, "image-1")).toThrow("预扣记录");
    expect(() => assertLingDrawImageReservation({ requestId: "other", billingStatus: "reserved" }, "image-1")).toThrow("预扣记录");
  });

  it("settles an image reservation only after persistence", async () => {
    process.env.PPT_INTERNAL_TOKEN = "bridge-secret";
    process.env.PPT_INTERNAL_URL = "http://lingdraw:37621";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true, requestId: "image-request-1", status: "succeeded", chargedPoints: 2, refundedPoints: 0, idempotent: false }));
    vi.stubGlobal("fetch", fetchMock);
    const user = { id: "shadow", externalUserId: "uid-1", username: "user", email: "user@internal.invalid", name: null, avatarUrl: null, role: "user" };
    await expect(settleLingDrawImage(user, { requestId: "image-request-1", success: true })).resolves.toMatchObject({ status: "succeeded" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://lingdraw:37621/api/ppt/internal/ai/image/settle");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ requestId: "image-request-1", success: true });
  });

  it("rejects an image settlement response for a different reservation", async () => {
    process.env.PPT_INTERNAL_TOKEN = "bridge-secret";
    process.env.PPT_INTERNAL_URL = "http://lingdraw:37621";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, requestId: "other", status: "succeeded" })));
    const user = { id: "shadow", externalUserId: "uid-1", username: "user", email: "user@internal.invalid", name: null, avatarUrl: null, role: "user" };
    await expect(settleLingDrawImage(user, { requestId: "image-request-1", success: true })).rejects.toThrow("返回格式");
  });

  it("retries the same image settlement decision without surfacing a false generation failure", async () => {
    process.env.PPT_INTERNAL_TOKEN = "bridge-secret";
    process.env.PPT_INTERNAL_URL = "http://lingdraw:37621";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(Response.json({ ok: true, requestId: "image-request-2", status: "succeeded", chargedPoints: 2, refundedPoints: 0, idempotent: false }));
    vi.stubGlobal("fetch", fetchMock);
    const user = { id: "shadow", externalUserId: "uid-1", username: "user", email: "user@internal.invalid", name: null, avatarUrl: null, role: "user" };
    await expect(settleLingDrawImageWithRetry(user, { requestId: "image-request-2", success: true })).resolves.toMatchObject({ status: "succeeded" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(JSON.parse(String(call[1]?.body))).toEqual({ requestId: "image-request-2", success: true });
    warning.mockRestore();
  });

  it("keeps host events and public resources base-path safe", () => {
    const bridge = readFileSync("components/host/LingDrawBridge.tsx", "utf8");
    for (const type of ["studio-theme", "studio-ui-scale", "studio-lang", "studio-activate", "ppt:ready"]) expect(bridge).toContain(type);
    expect(bridge).toContain('classList.toggle("studio-theme-dark", dark)');
    expect(bridge).toContain('classList.toggle("theme-dark", dark)');
    expect(bridge).toContain('style.setProperty("--studio-ui-scale"');
    expect(bridge).toContain("window.fetch = observedFetch");
    expect(bridge).toContain("observeHostAuthFailure(response)");
    expect(bridge).toContain("window.fetch = originalFetch");
    expect(readFileSync("src/lib/pdf/parser.ts", "utf8")).toContain('withBasePath("/pdf.worker.min.mjs")');
    expect(readFileSync("src/server/assets/service.ts", "utf8")).toContain("withBasePath(`/api/assets/");
    expect(readFileSync("components/workflow/UploadStep.tsx", "utf8")).toContain('withBasePath("/examples/product-import-template.xlsx")');
    expect(readFileSync("components/workflow/UploadStep.tsx", "utf8")).toContain('download="商品导入模板.xlsx"');
    const imageRoute = readFileSync("src/server/ai/imageGeneration.ts", "utf8");
    expect(imageRoute.indexOf("assertProjectOwner")).toBeLessThan(imageRoute.indexOf('lingDrawInternalUrl("/api/ppt/internal/ai/image")'));
    expect(imageRoute).toContain("settleLingDrawImageWithRetry(user, { requestId, success: true })");
    expect(imageRoute.indexOf("reservation = { requestId, user }")).toBeLessThan(imageRoute.indexOf('fetch(lingDrawInternalUrl("/api/ppt/internal/ai/image")'));
    expect(imageRoute).toContain('upstream.append("provider", providerId)');
    expect(imageRoute).toContain('upstream.append("model", model)');
    expect(imageRoute).toContain("success: assetPersisted");
    const navigation = readFileSync("components/library/ResourceNavigation.tsx", "utf8");
    expect(navigation).not.toContain("projects-user");
    expect(navigation).not.toContain("LogOut");
    expect(readFileSync("components/cloud/ProjectDashboard.tsx", "utf8")).not.toContain("上午好");
  });

  it("lists only configured image models and leaves selection to the user", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      providers: [
        { id: "modelscope", name: "ModelScope", enabled: true, available: false, image_models: ["unconfigured-model"] },
        {
          id: "custom-api",
          name: "comfly",
          enabled: true,
          available: true,
          image_models: ["gpt-image-2", "nano-banana-pro"],
          model_names: { "gpt-image-2": "GPT Image 2" },
        },
        { id: "disabled", name: "Disabled", enabled: false, available: true, image_models: ["hidden-model"] },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadImageModelOptions()).resolves.toEqual([
      { key: "custom-api::gpt-image-2", providerId: "custom-api", providerName: "comfly", model: "gpt-image-2", label: "comfly · GPT Image 2" },
      { key: "custom-api::nano-banana-pro", providerId: "custom-api", providerName: "comfly", model: "nano-banana-pro", label: "comfly · nano-banana-pro" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/ppt/api/ai/image-models", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it("reuses one Prisma client in the long-lived production sidecar", async () => {
    const state = globalThis as unknown as { folioPrisma?: unknown };
    const previous = state.folioPrisma;
    try {
      delete state.folioPrisma;
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PPT_DATABASE_URL", "mysql://folio:test@127.0.0.1:3307/folio");
      vi.resetModules();
      const { getPrisma } = await import("@/src/server/db/prisma");
      const first = getPrisma();
      expect(getPrisma()).toBe(first);
    } finally {
      if (previous) state.folioPrisma = previous;
      else delete state.folioPrisma;
    }
  });

  it("ends a client-side image job when the AI bridge never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })));

    const generation = generateProductImage({
      prompt: "办公桌上的商品",
      productName: "测试商品",
      referenceImages: [],
      aspectRatio: 1.5,
      providerId: "custom-api",
      model: "gpt-image-2",
    });
    const result = expect(generation).rejects.toThrow("任务编号已保留");
    await vi.advanceTimersByTimeAsync(PRODUCT_IMAGE_GENERATION_TIMEOUT_MS + 1);
    await result;
  });

  it("refreshes client-backed libraries whenever the host reactivates PPT", () => {
    const target = new EventTarget();
    const refreshed = vi.fn();
    const unsubscribe = listenForPptActivation(target, refreshed);
    target.dispatchEvent(new Event(PPT_ACTIVATE_EVENT));
    expect(refreshed).toHaveBeenCalledOnce();
    unsubscribe();
    target.dispatchEvent(new Event(PPT_ACTIVATE_EVENT));
    expect(refreshed).toHaveBeenCalledOnce();
    for (const file of ["components/cloud/ProjectDashboard.tsx", "components/cloud/ProjectUtilityDrawer.tsx", "components/library/ProductLibrary.tsx", "components/library/TemplateLibrary.tsx", "components/library/AssetLibrary.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("listenForPptActivation");
      expect(source, file).toContain("loadRequestId");
      expect(source, file).toContain("requestId === loadRequestId.current");
    }
  });

  it("translates PPT chrome in both directions after a host language message", () => {
    expect(translatePptText("商品库", "en-US")).toBe("Products");
    expect(translatePptText("Products", "zh-CN")).toBe("商品库");
    expect(translatePptText("共 12 个项目", "en-US")).toBe("12 projects");
    expect(translatePptText("上午好，王小明", "en-US")).toBe("Good morning, 王小明");
    expect(translatePptText("已选 3 个附件，将联合识别", "en-US")).toBe("3 attachments selected; they will be analyzed together");
    expect(translatePptText("检测到 2 个未解决数据冲突", "en-US")).toBe("2 unresolved data conflicts detected");
    expect(translatePptText("2026 春季产品手册", "en-US")).toBe("2026 春季 Product Deck");
    expect(translatePptText("低文字密度时启用 OCR fallback", "en-US")).toBe("Enable OCR fallback for low text density");
    expect(translatePptText("搜索模板名称、标签或适用场景", "en-US")).toBe("Search templates, tags, or use cases");
    expect(translatePptText("搜索 SKU、商品名称、品牌或规格", "en-US")).toBe("Search SKU, product name, brand, or specification");
    expect(translatePptText("永久删除「秋季手册」？该操作无法恢复。", "en-US")).toBe('Permanently delete "秋季手册"? This cannot be undone.');
    expect(translatePptText("该商品被 3 个项目使用。此次修改将同步影响 3 个项目，确认修改？", "en-US")).toBe("This product is used by 3 projects. This change affects 3 projects. Continue?");
    for (const [zh, en] of [
      ["设置分类", "Set category"], ["加入项目", "Add to project"], ["保存商品", "Save product"],
      ["模板加载失败", "Could not load template"], ["复制模板", "Duplicate template"], ["完成编辑", "Finish editing"],
      ["清除局部样式", "Clear local styles"], ["当前图片框没有可用的参考图片。", "No reference images are available for this image frame."],
    ]) {
      expect(translatePptText(zh, "en-US")).toBe(en);
      expect(translatePptText(en, "zh-CN")).toBe(zh);
    }
    for (const zh of ["商品", "页面", "存在错误", "AI 场景绘图"]) {
      const en = translatePptText(zh, "en-US");
      expect(en).not.toBe(zh);
      expect(translatePptText(en, "zh-CN")).toBe(zh);
    }
    const userData = resolvePptLocalizedValue("Products", "zh-CN");
    expect(userData.value).toBe("Products");
    const englishChrome = resolvePptLocalizedValue("商品", "en-US");
    const restoredChrome = resolvePptLocalizedValue(englishChrome.value, "zh-CN", englishChrome.state);
    expect(restoredChrome.value).toBe("商品");
    const localizer = readFileSync("components/host/PptDomLocalizer.tsx", "utf8");
    expect(localizer).toContain("useSyncExternalStore");
    expect(localizer).toContain("ppt:lang-change");
    expect(localizer).toContain("MutationObserver");
    expect(localizer).toContain('querySelectorAll("*")');
    expect(localizer).toContain("attributes: true");
    expect(localizer).toContain("attributeFilter: [...ATTRIBUTES]");
    expect(localizer).toContain("[data-ppt-no-translate]");
    expect(localizer).toContain("resolvePptLocalizedValue");
  });

  it("keeps user data and option submission values outside DOM translation", () => {
    const protectedFiles = [
      "components/cloud/ProjectDashboard.tsx",
      "components/library/ProductLibrary.tsx",
      "components/library/TemplateLibrary.tsx",
      "components/library/AssetLibrary.tsx",
      "components/workflow/BatchDashboard.tsx",
      "components/studio/EditorInspector.tsx",
      "components/workflow/SourcePreview.tsx",
      "components/workflow/MappingStep.tsx",
      "components/workflow/UploadStep.tsx",
      "components/workflow/ImportConflictPanel.tsx",
      "components/workflow/ProductAISuggestions.tsx",
    ];
    for (const file of protectedFiles) expect(readFileSync(file, "utf8"), file).toContain("data-ppt-no-translate");
    const optionViolations: string[] = [];
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : entry.name.endsWith(".tsx") ? [file] : [];
    });
    for (const file of [...walk("app"), ...walk("components")]) {
      const source = readFileSync(file, "utf8");
      if (/<option(?![^>]*\bvalue=)[^>]*>/.test(source)) optionViolations.push(file);
    }
    expect(optionViolations).toEqual([]);
    const templates = readFileSync("components/library/TemplateLibrary.tsx", "utf8");
    expect(templates).toContain('<option key={item} value={item}>');
    const chineseChromeFiles = [
      "components/cloud/ProjectDashboard.tsx", "components/library/AssetLibrary.tsx", "components/library/ProductLibrary.tsx",
      "components/library/TemplateLibrary.tsx", "components/studio/TemplateGallery.tsx", "components/workflow/AIReviewPanel.tsx",
      "components/workflow/BatchDashboard.tsx", "components/workflow/UploadStep.tsx", "components/workflow/MappingStep.tsx",
      "components/workflow/ConfirmStep.tsx", "app/projects/[projectId]/not-found.tsx",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const englishOnlyLabel of [
      "MY PROJECTS", "ASSET LIBRARY", "TEMPLATE SYSTEM", "PREVIEW GENERATING", "SYSTEM TEMPLATE", "PERSONAL TEMPLATE",
      "APPLY TEMPLATE", "THEME DEFINITION", "LIBRARY SETTINGS", "ADD TO PROJECT", "DESIGN SYSTEM", "AI DATA REVIEW",
      "BATCH GROUP", "SHARED PRODUCTS", "404 / PROJECT",
    ]) expect(chineseChromeFiles).not.toContain(englishOnlyLabel);
  });

  it("uses LingDraw dialogs instead of unthemed browser dialogs in core workflows", () => {
    const workflowFiles = [
      "components/cloud/ProjectDashboard.tsx",
      "components/cloud/ProjectUtilityDrawer.tsx",
      "components/library/ProductLibrary.tsx",
      "components/studio/CatalogStudio.tsx",
      "components/library/AssetLibrary.tsx",
      "components/studio/EditorInspector.tsx",
      "components/workflow/BatchDashboard.tsx",
    ];
    for (const file of workflowFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/window\.(?:prompt|confirm|alert)\s*\(/);
      expect(source, file).toContain("useStudioDialog");
    }
    const provider = readFileSync("components/host/StudioDialogProvider.tsx", "utf8");
    expect(provider).toContain('role={active.kind === "alert" ? "alertdialog" : "dialog"}');
    expect(provider).toContain("usePptI18n");
    expect(provider).toContain("studio-toast-region");
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("<StudioDialogProvider>");
  });

  it("uses LingDraw typography for editor chrome without overriding slide artwork", () => {
    const styles = readFileSync("app/lingdraw.css", "utf8");
    const marker = "/* Editor chrome follows LingDraw typography; slide artwork keeps its template fonts. */";
    const override = styles.slice(styles.indexOf(marker));
    for (const selector of [
      ".sidebar-heading strong",
      ".thumbnail-number",
      ".preview-page-count",
      ".layout-stat-list strong",
      ".layout-score strong",
      ".project-settings header h2",
      ".ai-review-intro h2",
      ".product-drawer > header h2",
    ]) expect(override).toContain(selector);
    expect(override).toContain("font-family: var(--studio-font)");
    expect(override).not.toContain(".br-");
    expect(override).not.toContain(".slide-frame");
    for (const selector of [
      ".layout-density-list div > span", ".editor-field-group label output", ".workflow-step > span",
      ".raw-excel-table thead th", ".mapping-score > strong", ".ai-review-metrics strong",
      ".confirmation-stats strong", ".product-row > td:nth-child(2) strong", ".import-summary-stats strong",
    ]) expect(styles).toContain(selector);
  });

  it("keeps project setup and import chrome readable in both host themes", () => {
    const styles = readFileSync("app/lingdraw.css", "utf8");
    const marker = "/* Project/import workflow chrome keeps sufficient contrast in both host themes. */";
    const override = styles.slice(styles.indexOf(marker));
    for (const selector of [
      ".project-settings header p",
      ".project-settings .settings-grid label",
      ".project-settings .logo-upload small",
      ".project-settings .logo-upload",
      ".project-settings .mock-data-link",
      ".excel-dropzone strong",
      ".mapping-list-head",
      ".product-confirm-table th",
      ".product-row.is-selected td",
      ".ai-image-generated-result > span",
    ]) expect(override).toContain(selector);
    for (const token of ["var(--studio-text)", "var(--studio-muted)", "var(--studio-panel)", "var(--studio-panel-soft)", "var(--studio-border)"]) expect(override).toContain(token);
    expect(override).not.toContain(".br-");
    expect(override).not.toContain(".slide-frame");
  });

  it("lets Next add basePath to server redirects exactly once", () => {
    const serverPages = ["app/page.tsx", "app/projects/page.tsx", "app/projects/[projectId]/page.tsx", "app/products/page.tsx", "app/templates/page.tsx", "app/assets/page.tsx"];
    for (const file of serverPages) expect(readFileSync(file, "utf8")).not.toContain("redirect(withBasePath");
  });

  it("does not introduce unwrapped PPT root-path requests", () => {
    const walk = (directory: string): string[] => {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
      });
    };
    const files = ["app", "components", "src"].flatMap(walk);
    const violations: string[] = [];
    for (const file of files) {
      for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
        const rawFetch = /\bfetch\s*\(\s*["'`]\/(?!\/)/.test(line);
        const rawXhr = /request\.open\s*\([^,]+,\s*["'`]\/(?!\/)/.test(line);
        const rawWorker = /workerSrc\s*=\s*["'`]\/(?!\/)/.test(line);
        const allowedHostLogout = file.replaceAll("\\", "/").endsWith("components/library/ResourceNavigation.tsx") && line.includes('fetch("/api/auth/logout"');
        if ((rawFetch && !allowedHostLogout) || rawXhr || rawWorker) violations.push(`${file}:${index + 1}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
