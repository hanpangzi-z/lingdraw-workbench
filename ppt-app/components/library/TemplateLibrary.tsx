"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Heart,
  Layers3,
  LoaderCircle,
  Palette,
  PencilLine,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { getAvailableThemes } from "@/src/themes/registry";
import { ResourceNavigation } from "./ResourceNavigation";
import { pptFetch } from "@/src/lib/basePath";
import { listenForPptActivation } from "@/src/lib/hostEvents";

const builtInThemeRendererKeys = getAvailableThemes().map((theme) => theme.id);

interface TemplateRow {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  status: "draft" | "published" | "archived";
  version: number;
  rendererKey: string;
  config: unknown;
  tags: string[];
  isSystem: boolean;
  scope: string;
  usageCount: number;
  thumbnailUrl?: string | null;
  favorite: boolean;
  theme?: {
    id: string;
    name: string;
    rendererKey: string;
    tokens: unknown;
    version: number;
  } | null;
  updatedAt: string;
}
interface ThemeRow {
  id: string;
  name: string;
  rendererKey: string;
  tokens: unknown;
  isSystem: boolean;
  status: string;
  version: number;
  updatedAt: string;
}
interface TemplateList {
  items: TemplateRow[];
  page: number;
  total: number;
  pageCount: number;
  stats: { custom: number; favorites: number };
}

export function TemplateLibrary() {
  const router = useRouter();
  const [data, setData] = useState<TemplateList>();
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [mode, setMode] = useState<"templates" | "themes">("templates");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<TemplateRow>();
  const [editing, setEditing] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    description: "",
    category: "商品目录",
    status: "draft",
    tags: "",
    config: "{}",
    themeDefinitionId: "",
  });
  const [projectPicker, setProjectPicker] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [themeEditor, setThemeEditor] = useState<{
    id?: string;
    name: string;
    rendererKey: string;
    status: string;
    tokens: string;
  }>();
  const loadRequestId = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "24",
        sort,
      });
      if (query) params.set("search", query);
      if (category) params.set("category", category);
      if (scope) params.set("scope", scope);
      const [templatesResponse, themesResponse] = await Promise.all([
        pptFetch(`/api/templates?${params}`),
        pptFetch("/api/themes"),
      ]);
      const templatesPayload = await templatesResponse.json();
      const themesPayload = await themesResponse.json();
      if (!templatesResponse.ok) throw new Error(templatesPayload.error);
      if (!themesResponse.ok) throw new Error(themesPayload.error);
      if (requestId !== loadRequestId.current) return;
      setData(templatesPayload);
      setThemes(themesPayload.items);
      setError("");
    } catch (cause) {
      if (requestId === loadRequestId.current)
        setError(cause instanceof Error ? cause.message : "资源加载失败");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [category, page, query, scope, sort]);
  useEffect(() => {
    void load();
    return listenForPptActivation(window, () => void load());
  }, [load]);
  const openDetail = async (id: string) => {
    setWorking(true);
    try {
      const response = await pptFetch(`/api/templates/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDetail(payload);
      setTemplateForm({
        name: payload.name,
        description: payload.description || "",
        category: payload.category,
        status: payload.status,
        tags: payload.tags.join("，"),
        config: JSON.stringify(payload.config, null, 2),
        themeDefinitionId: payload.theme?.id || "",
      });
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模板加载失败");
    } finally {
      setWorking(false);
    }
  };
  const copy = async (id: string) => {
    setWorking(true);
    try {
      const response = await pptFetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await load();
      await openDetail(payload.id);
      setEditing(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复制失败");
    } finally {
      setWorking(false);
    }
  };
  const favorite = async (template: TemplateRow) => {
    const response = await pptFetch(`/api/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "favorite" }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error);
      return;
    }
    if (detail?.id === template.id)
      setDetail({ ...detail, favorite: payload.favorite });
    await load();
  };
  const saveTemplate = async () => {
    if (!detail) return;
    setWorking(true);
    try {
      let config: unknown;
      try {
        config = JSON.parse(templateForm.config);
      } catch {
        throw new Error("模板配置 JSON 格式不正确");
      }
      const response = await pptFetch(`/api/templates/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...templateForm,
          tags: templateForm.tags
            .split(/[，,]/)
            .map((item) => item.trim())
            .filter(Boolean),
          config,
          themeDefinitionId: templateForm.themeDefinitionId || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDetail(payload);
      setEditing(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setWorking(false);
    }
  };
  const chooseProject = async () => {
    const response = await pptFetch("/api/projects?page=1&pageSize=50");
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error);
      return;
    }
    setProjects(payload.items);
    setProjectPicker(true);
  };
  const apply = async (projectId: string) => {
    if (!detail) return;
    setWorking(true);
    try {
      const response = await pptFetch(`/api/templates/${detail.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      router.push(`/projects/${projectId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "应用模板失败");
    } finally {
      setWorking(false);
    }
  };
  const editTheme = (theme?: ThemeRow) =>
    setThemeEditor(
      theme
        ? {
            id: theme.id,
            name: theme.name,
            rendererKey: theme.rendererKey,
            status: theme.status,
            tokens: JSON.stringify(theme.tokens, null, 2),
          }
        : {
            name: "我的品牌主题",
            rendererKey: "business-red",
            status: "draft",
            tokens: JSON.stringify(
              themes.find((item) => item.rendererKey === "business-red")
                ?.tokens || {},
              null,
              2,
            ),
          },
    );
  const saveTheme = async () => {
    if (!themeEditor) return;
    setWorking(true);
    try {
      let tokens: unknown;
      try {
        tokens = JSON.parse(themeEditor.tokens);
      } catch {
        throw new Error("Theme Tokens JSON 格式不正确");
      }
      const response = await pptFetch(
        themeEditor.id ? `/api/themes/${themeEditor.id}` : "/api/themes",
        {
          method: themeEditor.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: themeEditor.name,
            rendererKey: themeEditor.rendererKey,
            status: themeEditor.status,
            tokens,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setThemeEditor(undefined);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "主题保存失败");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="resource-shell">
      <ResourceNavigation />
      <section className="resource-content">
        <header className="resource-heading">
          <div>
            <span>模板系统 / {String(data?.total || 0).padStart(3, "0")}</span>
            <h1>模板库</h1>
            <p>
              模板保存配置与资源快照，React 和 PPT Renderer 继续由稳定代码提供。
            </p>
          </div>
          <div>
            <button
              className={mode === "templates" ? "primary" : "secondary"}
              onClick={() => setMode("templates")}
            >
              <Layers3 />
              模板
            </button>
            <button
              className={mode === "themes" ? "primary" : "secondary"}
              onClick={() => setMode("themes")}
            >
              <Palette />
              Theme
            </button>
            {mode === "themes" && (
              <button className="primary" onClick={() => editTheme()}>
                <Plus />
                新建 Theme
              </button>
            )}
          </div>
        </header>
        <div className="resource-metrics">
          <div>
            <span>可用模板</span>
            <strong>{data?.total || 0}</strong>
          </div>
          <div>
            <span>个人模板</span>
            <strong>{data?.stats.custom || 0}</strong>
          </div>
          <div>
            <span>已收藏</span>
            <strong>{data?.stats.favorites || 0}</strong>
          </div>
          <div>
            <span>Theme</span>
            <strong>{themes.length}</strong>
          </div>
        </div>
        {error && (
          <div className="resource-message is-error">
            {error}
            <button onClick={() => setError("")}>
              <X />
            </button>
          </div>
        )}
        {mode === "templates" ? (
          <section className="template-library">
            <div className="resource-toolbar">
              <label className="resource-search">
                <Search />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索模板名称、标签或适用场景"
                />
              </label>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">全部分类</option>
                {["企业商务", "商品目录", "节日福利", "高端礼品", "极简"].map(
                  (item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ),
                )}
              </select>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="">系统与个人</option>
                <option value="system">系统模板</option>
                <option value="personal">个人模板</option>
              </select>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="recent">最近更新</option>
                <option value="usage">使用次数</option>
                <option value="name">模板名称</option>
              </select>
            </div>
            {loading ? (
              <div className="resource-loading">
                <LoaderCircle className="is-spinning" />
                正在读取模板库...
              </div>
            ) : (
              <div className="template-resource-grid">
                {data?.items.map((template) => (
                  <article key={template.id}>
                    <button
                      className="template-preview"
                      onClick={() => void openDetail(template.id)}
                    >
                      {template.thumbnailUrl ? (
                        <img src={template.thumbnailUrl} alt="" />
                      ) : (
                        <div>
                          <Sparkles />
                          <span>预览生成中</span>
                        </div>
                      )}
                      <i>{template.isSystem ? "系统" : "个人"}</i>
                    </button>
                    <div>
                      <span data-ppt-no-translate translate="no">
                        {template.category} · v{template.version}
                      </span>
                      <button
                        className={template.favorite ? "is-favorite" : ""}
                        onClick={() => void favorite(template)}
                      >
                        <Heart />
                      </button>
                    </div>
                    <button
                      className="template-name"
                      data-ppt-no-translate
                      translate="no"
                      onClick={() => void openDetail(template.id)}
                    >
                      {template.name}
                    </button>
                    <p data-ppt-no-translate translate="no">
                      {template.description}
                    </p>
                    <footer>
                      <span data-ppt-no-translate translate="no">
                        {template.theme?.name || "默认 Theme"}
                      </span>
                      <b>{`${template.usageCount} 次使用`}</b>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            {data && data.pageCount > 1 && (
              <footer className="resource-pagination">
                <span>共 {data.total} 套模板</span>
                <div>
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft />
                  </button>
                  <strong>
                    {page} / {data.pageCount}
                  </strong>
                  <button
                    disabled={page >= data.pageCount}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight />
                  </button>
                </div>
              </footer>
            )}
          </section>
        ) : (
          <section className="theme-library">
            <header>
              <div>
                <span>主题配置</span>
                <h2>主题资源</h2>
              </div>
              <p>
                系统 Theme 作为稳定 fallback；个人 Theme 通过 Tokens
                覆盖颜色、字体和装饰。
              </p>
            </header>
            <div>
              {themes.map((theme) => {
                const colors =
                  (theme.tokens as { colors?: Record<string, string> })
                    .colors || {};
                return (
                  <article key={theme.id}>
                    <div className="theme-swatches">
                      {[
                        colors.primary,
                        colors.background,
                        colors.surface,
                        colors.accent,
                      ]
                        .filter(Boolean)
                        .map((color) => (
                          <i key={color} style={{ background: color }} />
                        ))}
                    </div>
                    <span>
                      {theme.isSystem ? "系统" : "个人"} · v{theme.version}
                    </span>
                    <strong data-ppt-no-translate translate="no">
                      {theme.name}
                    </strong>
                    <small data-ppt-no-translate translate="no">
                      {theme.rendererKey}
                    </small>
                    <button
                      disabled={theme.isSystem}
                      onClick={() => editTheme(theme)}
                    >
                      {theme.isSystem ? (
                        "内置主题"
                      ) : (
                        <>
                          <PencilLine />
                          编辑 Tokens
                        </>
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>
      {detail && (
        <div
          className="library-drawer-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDetail(undefined)
          }
        >
          <aside className="template-detail-drawer">
            <header>
              <div>
                <small>
                  {detail.isSystem
                    ? "系统模板"
                    : `个人模板 / V${detail.version}`}
                </small>
                <h2 data-ppt-no-translate translate="no">
                  {detail.name}
                </h2>
              </div>
              <button onClick={() => setDetail(undefined)}>
                <X />
              </button>
            </header>
            <div className="template-detail-scroll">
              <div className="template-large-preview">
                {detail.thumbnailUrl ? (
                  <img src={detail.thumbnailUrl} alt="" />
                ) : (
                  <Sparkles />
                )}
              </div>
              {editing ? (
                <section className="template-edit-form">
                  <label>
                    模板名称
                    <input
                      value={templateForm.name}
                      onChange={(event) =>
                        setTemplateForm({
                          ...templateForm,
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    描述
                    <textarea
                      value={templateForm.description}
                      onChange={(event) =>
                        setTemplateForm({
                          ...templateForm,
                          description: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div>
                    <label>
                      分类
                      <select
                        value={templateForm.category}
                        onChange={(event) =>
                          setTemplateForm({
                            ...templateForm,
                            category: event.target.value,
                          })
                        }
                      >
                        {[
                          "企业商务",
                          "商品目录",
                          "节日福利",
                          "高端礼品",
                          "极简",
                        ].map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      状态
                      <select
                        value={templateForm.status}
                        onChange={(event) =>
                          setTemplateForm({
                            ...templateForm,
                            status: event.target.value,
                          })
                        }
                      >
                        <option value="draft">草稿</option>
                        <option value="published">已发布</option>
                        <option value="archived">归档</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    默认 Theme
                    <select
                      value={templateForm.themeDefinitionId}
                      onChange={(event) =>
                        setTemplateForm({
                          ...templateForm,
                          themeDefinitionId: event.target.value,
                        })
                      }
                    >
                      {themes.map((theme) => (
                        <option
                          data-ppt-no-translate
                          translate="no"
                          key={theme.id}
                          value={theme.id}
                        >
                          {theme.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    标签
                    <input
                      value={templateForm.tags}
                      onChange={(event) =>
                        setTemplateForm({
                          ...templateForm,
                          tags: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    模板配置 JSON
                    <textarea
                      className="code-editor"
                      rows={15}
                      value={templateForm.config}
                      onChange={(event) =>
                        setTemplateForm({
                          ...templateForm,
                          config: event.target.value,
                        })
                      }
                    />
                  </label>
                </section>
              ) : (
                <section className="template-spec">
                  <div>
                    <span>适用场景</span>
                    <strong data-ppt-no-translate translate="no">
                      {detail.category}
                    </strong>
                  </div>
                  <div>
                    <span>默认 Theme</span>
                    <strong data-ppt-no-translate translate="no">
                      {detail.theme?.name || "代码默认"}
                    </strong>
                  </div>
                  <div>
                    <span>Renderer</span>
                    <strong data-ppt-no-translate translate="no">
                      {detail.rendererKey}
                    </strong>
                  </div>
                  <div>
                    <span>使用次数</span>
                    <strong>{detail.usageCount}</strong>
                  </div>
                  <p data-ppt-no-translate translate="no">
                    {detail.description}
                  </p>
                  <div
                    className="template-tags"
                    data-ppt-no-translate
                    translate="no"
                  >
                    {detail.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <h3>支持版式配置</h3>
                  <pre>{JSON.stringify(detail.config, null, 2)}</pre>
                </section>
              )}
            </div>
            <footer>
              {editing ? (
                <>
                  <button onClick={() => setEditing(false)}>取消</button>
                  <button
                    className="primary"
                    onClick={() => void saveTemplate()}
                    disabled={working}
                  >
                    <Check />
                    保存配置
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => void favorite(detail)}>
                    <Heart />
                    {detail.favorite ? "取消收藏" : "收藏"}
                  </button>
                  <button onClick={() => void copy(detail.id)}>
                    <Copy />
                    复制模板
                  </button>
                  {!detail.isSystem && (
                    <button onClick={() => setEditing(true)}>
                      <PencilLine />
                      编辑配置
                    </button>
                  )}
                  <button
                    className="primary"
                    onClick={() => void chooseProject()}
                  >
                    <Eye />
                    使用模板
                  </button>
                </>
              )}
            </footer>
          </aside>
        </div>
      )}
      {projectPicker && detail && (
        <div className="resource-modal-backdrop">
          <section className="project-picker-modal">
            <header>
              <div>
                <small>应用模板</small>
                <h2>选择项目</h2>
              </div>
              <button onClick={() => setProjectPicker(false)}>
                <X />
              </button>
            </header>
            <div>
              {projects.map((project) => (
                <button key={project.id} onClick={() => void apply(project.id)}>
                  <Layers3 />
                  <span>
                    <strong data-ppt-no-translate translate="no">
                      {project.name}
                    </strong>
                    <small>应用后仍保存当前模板快照</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {themeEditor && (
        <div className="resource-modal-backdrop">
          <section className="theme-editor-modal">
            <header>
              <div>
                <small>主题定义</small>
                <h2>{themeEditor.id ? "编辑 Theme" : "新建 Theme"}</h2>
              </div>
              <button onClick={() => setThemeEditor(undefined)}>
                <X />
              </button>
            </header>
            <label>
              名称
              <input
                value={themeEditor.name}
                onChange={(event) =>
                  setThemeEditor({ ...themeEditor, name: event.target.value })
                }
              />
            </label>
            <div>
              <label>
                代码 fallback
                <select
                  value={themeEditor.rendererKey}
                  onChange={(event) =>
                    setThemeEditor({
                      ...themeEditor,
                      rendererKey: event.target.value,
                    })
                  }
                >
                  {builtInThemeRendererKeys.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                状态
                <select
                  value={themeEditor.status}
                  onChange={(event) =>
                    setThemeEditor({
                      ...themeEditor,
                      status: event.target.value,
                    })
                  }
                >
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="archived">归档</option>
                </select>
              </label>
            </div>
            <label>
              Theme Tokens JSON
              <textarea
                className="code-editor"
                rows={20}
                value={themeEditor.tokens}
                onChange={(event) =>
                  setThemeEditor({ ...themeEditor, tokens: event.target.value })
                }
              />
            </label>
            <footer>
              <button onClick={() => setThemeEditor(undefined)}>取消</button>
              <button
                className="primary"
                onClick={() => void saveTheme()}
                disabled={working}
              >
                <Check />
                保存 Theme
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
