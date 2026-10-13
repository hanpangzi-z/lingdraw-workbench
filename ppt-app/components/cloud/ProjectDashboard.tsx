"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  Grid2X2,
  List,
  MoreHorizontal,
  Package,
  PencilLine,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type {
  ProjectListDto,
  ProjectSummaryDto,
} from "@/src/server/projects/types";
import { ResourceNavigation } from "@/components/library/ResourceNavigation";
import { pptFetch } from "@/src/lib/basePath";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { usePptI18n } from "@/components/host/PptDomLocalizer";
import { listenForPptActivation } from "@/src/lib/hostEvents";
import { ProjectPageThumbnail } from "./ProjectPageThumbnail";

type Sort = "recent" | "created" | "name";

const statusLabels: Record<ProjectSummaryDto["status"], string> = {
  draft: "草稿",
  ready: "已就绪",
  exported: "已导出",
  archived: "已归档",
};
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function ProjectDashboard() {
  const router = useRouter();
  const dialog = useStudioDialog();
  const { t } = usePptI18n();
  const [data, setData] = useState<ProjectListDto>();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [trash, setTrash] = useState(false);
  const [menuId, setMenuId] = useState<string>();
  const [error, setError] = useState("");
  const [localProject, setLocalProject] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const loadRequestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setLocalProject(Boolean(window.localStorage.getItem("folio.editor.v1")));
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        sort,
        trash: String(trash),
      });
      if (query) params.set("search", query);
      const response = await pptFetch(`/api/projects?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "项目列表加载失败");
      if (requestId !== loadRequestId.current) return;
      setData(payload);
      setError("");
    } catch (cause) {
      if (requestId === loadRequestId.current)
        setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [page, query, sort, trash]);
  useEffect(() => {
    void load();
    return listenForPptActivation(window, () => void load());
  }, [load]);

  const migrateLocal = async () => {
    const raw = window.localStorage.getItem("folio.editor.v1");
    if (!raw) return;
    setMigrating(true);
    try {
      const parsed = JSON.parse(raw) as { snapshot?: Record<string, unknown> };
      if (!parsed.snapshot) throw new Error("本地记录已损坏");
      const response = await pptFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "从本地恢复的产品手册",
          snapshot: { ...parsed.snapshot, layoutMode: "smart" },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "迁移失败");
      router.push(`/projects/${payload.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "迁移失败");
      setMigrating(false);
    }
  };

  const action = async (
    project: ProjectSummaryDto,
    operation: "duplicate" | "rename" | "delete" | "restore" | "permanent",
  ) => {
    setMenuId(undefined);
    setError("");
    try {
      let response: Response;
      if (operation === "rename") {
        const name = await dialog.prompt("输入新的项目名称", project.name);
        if (!name || name === project.name) return;
        response = await pptFetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", name }),
        });
      } else if (operation === "duplicate")
        response = await pptFetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duplicate" }),
        });
      else if (operation === "restore")
        response = await pptFetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
      else {
        if (
          !(await dialog.confirm(
            operation === "permanent"
              ? `永久删除「${project.name}」？该操作无法恢复。`
              : `将「${project.name}」移入回收站？`,
          ))
        )
          return;
        response = await pptFetch(
          `/api/projects/${project.id}${operation === "permanent" ? "?permanent=true" : ""}`,
          { method: "DELETE" },
        );
      }
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "操作失败");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  return (
    <main className="projects-shell">
      <ResourceNavigation />

      <section className="projects-content">
        <div className="projects-hero projects-actions-only">
          <div className="projects-hero-actions">
            {trash ? (
              <button
                className="project-import-button"
                onClick={() => {
                  setTrash(false);
                  setPage(1);
                }}
              >
                <ArchiveRestore aria-hidden="true" />
                返回项目
              </button>
            ) : (
              <>
                <button
                  className="project-import-button"
                  onClick={() => {
                    setTrash(true);
                    setPage(1);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  回收站
                </button>
                <button
                  className="project-import-button"
                  onClick={() => router.push("/projects/new?intent=import")}
                >
                  <UploadCloud aria-hidden="true" />
                  导入项目
                </button>
                <button
                  className="project-create-button"
                  onClick={() => router.push("/projects/new")}
                >
                  <Plus aria-hidden="true" />
                  新建项目
                </button>
              </>
            )}
          </div>
        </div>

        {!trash && <p className="project-demo-link">想先了解生成效果？<Link href="/demo">查看示例（只读，不创建项目）</Link></p>}
        {localProject && !trash && (
          <div className="local-migration-banner">
            <div>
              <FilePlus2 aria-hidden="true" />
              <span>
                <strong>发现本地编辑记录</strong>
                <small>可将当前浏览器里的项目保存到云端工作台。</small>
              </span>
            </div>
            <div>
              <button onClick={() => setLocalProject(false)}>暂不处理</button>
              <button onClick={() => void migrateLocal()} disabled={migrating}>
                {migrating ? "迁移中..." : "保存到云端"}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="projects-error" role="alert">
            {error}
            <button onClick={() => void load()}>重试</button>
          </div>
        )}

        <section className="project-library">
          <header>
            <div>
              <span>{trash ? "已删除" : "项目库"}</span>
              <h2>{trash ? "回收站" : "全部项目"}</h2>
            </div>
            <div className="project-library-tools">
              <label>
                <Search aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索项目、地区或档位"
                />
              </label>
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as Sort);
                  setPage(1);
                }}
              >
                <option value="recent">最近编辑</option>
                <option value="created">创建时间</option>
                <option value="name">项目名称</option>
              </select>
              <div className="view-switch">
                <button
                  className={view === "grid" ? "is-active" : ""}
                  onClick={() => setView("grid")}
                  aria-label="网格视图"
                  aria-pressed={view === "grid"}
                >
                  <Grid2X2 aria-hidden="true" />
                </button>
                <button
                  className={view === "list" ? "is-active" : ""}
                  onClick={() => setView("list")}
                  aria-label="列表视图"
                  aria-pressed={view === "list"}
                >
                  <List aria-hidden="true" />
                </button>
              </div>
            </div>
          </header>
          {loading ? (
            <div className="project-skeleton-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} />
              ))}
            </div>
          ) : !data?.items.length ? (
            <div className="project-empty">
              <Package aria-hidden="true" />
              <h3>{trash ? "回收站是空的" : "还没有项目"}</h3>
              <p>
                {query
                  ? "没有找到匹配项目。"
                  : trash
                    ? "删除的项目会出现在这里。"
                    : "创建项目后，所有资料会自动保存。"}
              </p>
              {!trash && !query && (
                <button onClick={() => router.push("/projects/new")}>
                  <Plus aria-hidden="true" />
                  创建第一个项目
                </button>
              )}
            </div>
          ) : (
            <div className={`project-card-grid is-${view}`}>
              {data.items.map((project) => (
                <article
                  className={`project-card ${menuId === project.id ? "is-menu-open" : ""}`}
                  key={project.id}
                >
                  <Link
                    className="project-card-cover"
                    href={trash ? "#" : `/projects/${project.id}`}
                    onClick={(event) => trash && event.preventDefault()}
                  >
                    <ProjectPageThumbnail projectId={project.id} name={project.name} revision={project.revision} />
                    <i>{statusLabels[project.status]}</i>
                  </Link>
                  <div className="project-card-body">
                    <div>
                      <Link
                        data-ppt-no-translate
                        translate="no"
                        href={trash ? "#" : `/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                      <span className="project-identity">{project.templateName || "产品手册"} · 创建于 {dateLabel(project.createdAt)} · #{project.id.slice(-6)}</span>
                      <span data-ppt-no-translate translate="no">
                        {project.region || t("未设置地区", "Region not set")} ·{" "}
                        {project.priceTier
                          ? t(
                              `${project.priceTier}元档`,
                              `¥${project.priceTier} tier`,
                            )
                          : t("未设置档位", "Tier not set")}
                      </span>
                    </div>
                    <button
                      aria-label={`打开「${project.name}」项目操作菜单`}
                      aria-expanded={menuId === project.id}
                      onClick={() =>
                        setMenuId(
                          menuId === project.id ? undefined : project.id,
                        )
                      }
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                    {menuId === project.id && (
                      <div className="project-card-menu">
                        {trash ? (
                          <>
                            <button
                              onClick={() => void action(project, "restore")}
                            >
                              <ArchiveRestore aria-hidden="true" />
                              恢复
                            </button>
                            <button
                              className="is-danger"
                              onClick={() => void action(project, "permanent")}
                            >
                              <Trash2 aria-hidden="true" />
                              永久删除
                            </button>
                          </>
                        ) : (
                          <>
                            <Link href={`/projects/${project.id}`}>
                              <PencilLine aria-hidden="true" />
                              打开
                            </Link>
                            <button
                              onClick={() => void action(project, "duplicate")}
                            >
                              <Copy aria-hidden="true" />
                              复制
                            </button>
                            <button
                              onClick={() => void action(project, "rename")}
                            >
                              <PencilLine aria-hidden="true" />
                              重命名
                            </button>
                            <button
                              className="is-danger"
                              onClick={() => void action(project, "delete")}
                            >
                              <Trash2 aria-hidden="true" />
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <footer>
                    <span>
                      <Package aria-hidden="true" />
                      {`${project.productCount} 商品`}
                    </span>
                    <span>{`${project.slideCount} 页`}</span>
                    <span>{`${project.categoryCount} 分类`}</span>
                    <time>{dateLabel(project.updatedAt)}</time>
                  </footer>
                </article>
              ))}
            </div>
          )}
          {data && data.pageCount > 1 && (
            <footer className="project-pagination">
              <span>{`共 ${data.total} 个项目`}</span>
              <div>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <strong>
                  {page} / {data.pageCount}
                </strong>
                <button
                  disabled={page >= data.pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </footer>
          )}
        </section>
      </section>
    </main>
  );
}
