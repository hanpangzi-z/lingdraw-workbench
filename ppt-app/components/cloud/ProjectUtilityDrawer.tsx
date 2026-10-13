"use client";

import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, CheckCircle2, Download, File, FileArchive, FileImage, FileSpreadsheet, History, Image, Library, LoaderCircle, PackageCheck, Plus, RefreshCw, Save, UploadCloud, X } from "lucide-react";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";
import type { ClientAsset, ClientAssetType } from "@/src/lib/cloud/upload";
import { pptFetch } from "@/src/lib/basePath";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { listenForPptActivation } from "@/src/lib/hostEvents";
import { requireSaved, type SaveResult } from "@/src/lib/cloud/saveResult";

interface VersionDto { id: string; versionNumber: number; label?: string; reason?: string; createdAt: string; createdBy: { name?: string; email: string } }
interface SyncDto { clientId: string; globalProductId: string; currentVersion: number; latestVersion: number; fields: string[]; current: { name: string; sku: string }; latest: { name: string; sku: string } }
const iconFor = (asset: ClientAsset) => asset.type === "product_image" || asset.type === "thumbnail" || asset.type === "logo" ? FileImage : asset.mimeType.includes("sheet") || /xlsx?/.test(asset.fileName) ? FileSpreadsheet : asset.type === "generated_ppt" ? FileArchive : File;
const sizeLabel = (size: number) => size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

export function ProjectUtilityDrawer({ projectId, panel, onClose, onSave, onRestore, uploadAsset }: {
  projectId: string; panel: "files" | "versions" | "sync" | null; onClose: () => void; onSave: () => Promise<SaveResult>;
  onRestore: (snapshot: CloudProjectSnapshot, revision: number) => void;
  uploadAsset: (file: File, type: ClientAssetType, onProgress?: (percent: number) => void) => Promise<ClientAsset>;
}) {
  const dialog = useStudioDialog();
  const [assets, setAssets] = useState<ClientAsset[]>([]);
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [syncItems, setSyncItems] = useState<SyncDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const loadRequestId = useRef(0);

  const load = async () => {
    const requestId = ++loadRequestId.current;
    if (!panel) return;
    setLoading(true); setError("");
    try {
      const response = await pptFetch(`/api/projects/${projectId}/${panel === "files" ? "assets" : panel === "versions" ? "versions" : "product-sync"}`);
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "加载失败");
      if (requestId !== loadRequestId.current) return;
      if (panel === "files") setAssets(payload.items); else if (panel === "versions") setVersions(payload.items); else setSyncItems(payload.items);
      setError("");
    } catch (cause) {
      if (requestId === loadRequestId.current) setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); return listenForPptActivation(window, () => void load()); }, [panel, projectId]);
  if (!panel) return null;

  const upload = async (file?: File) => {
    if (!file) return; setWorking(true); setError("");
    try { await uploadAsset(file, "source_file", setProgress); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "上传失败"); }
    finally { setWorking(false); setProgress(undefined); }
  };
  const saveVersion = async () => {
    setWorking(true); setError("");
    try {
      const receipt = requireSaved(await onSave());
      const response = await pptFetch(`/api/projects/${projectId}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "手动保存", reason: "manual", snapshot: receipt.snapshot, expectedRevision: receipt.revision }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "版本保存失败"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "版本保存失败"); }
    finally { setWorking(false); }
  };
  const restore = async (version: VersionDto) => {
    if (!await dialog.confirm(`恢复到 v${version.versionNumber}？当前状态会先自动保存为新版本。`)) return;
    setWorking(true); setError("");
    try {
      requireSaved(await onSave());
      const response = await pptFetch(`/api/projects/${projectId}/versions/${version.id}/restore`, { method: "POST" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "版本恢复失败");
      onRestore(payload.snapshot, payload.revision); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "版本恢复失败"); }
    finally { setWorking(false); }
  };
  const applySync = async (updates: { clientId: string; fields?: string[]; ignore?: boolean }[]) => {
    setWorking(true); setError("");
    try {
      requireSaved(await onSave());
      const response = await pptFetch(`/api/projects/${projectId}/product-sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "商品同步失败");
      const projectResponse = await pptFetch(`/api/projects/${projectId}`); const project = await projectResponse.json(); if (!projectResponse.ok) throw new Error(project.error || "项目刷新失败");
      onRestore(project.snapshot, project.revision); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "商品同步失败"); }
    finally { setWorking(false); }
  };
  const fieldLabels: Record<string, string> = { sku: "SKU", name: "名称", items: "规格", marketPrice: "市场价", salePrice: "套餐价", delivery: "配送", category: "分类", imageAssetId: "图片" };
  const panelTitle = panel === "files" ? ["项目文件", "项目文件"] : panel === "versions" ? ["版本历史", "版本历史"] : ["商品库", "商品库更新"];

  return <div className="utility-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="utility-drawer"><header><div>{panel === "files" ? <FileArchive aria-hidden="true" /> : panel === "versions" ? <History aria-hidden="true" /> : <Library aria-hidden="true" />}<span><small>{panelTitle[0]}</small><strong>{panelTitle[1]}</strong></span></div><button onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="utility-drawer-actions">{panel === "files" ? <><input ref={input} type="file" hidden onChange={(event) => void upload(event.target.files?.[0])} /><button onClick={() => input.current?.click()} disabled={working}><UploadCloud aria-hidden="true" />上传项目文件</button></> : panel === "versions" ? <button onClick={() => void saveVersion()} disabled={working}><Save aria-hidden="true" />保存当前版本</button> : <button onClick={() => void applySync(syncItems.map((item) => ({ clientId: item.clientId })))} disabled={working || !syncItems.length}><RefreshCw aria-hidden="true" />全部更新</button>}{working && <span><LoaderCircle className="is-spinning" aria-hidden="true" />{progress != null ? `${progress}%` : "处理中..."}</span>}</div>
    {error && <div className="utility-error">{error}<button onClick={() => void load()}>重试</button></div>}
    <div className="utility-list">{loading ? <div className="utility-loading"><LoaderCircle className="is-spinning" />加载中...</div> : panel === "files" ? assets.length ? assets.map((asset) => { const Icon = iconFor(asset); return <article key={asset.id}><Icon aria-hidden="true" /><div><strong>{asset.fileName}</strong><span>{sizeLabel(asset.size)} · {new Date(asset.createdAt).toLocaleString("zh-CN")}</span></div><a href={`${asset.url}?download=1`}><Download aria-hidden="true" />下载</a></article>; }) : <div className="utility-empty"><Plus /><strong>还没有项目文件</strong><span>原始 Excel、PDF、Word、PPT 以及导出文件会出现在这里。</span></div> : panel === "versions" ? versions.length ? versions.map((version) => <article className="version-row" key={version.id}><span>v{version.versionNumber}</span><div><strong>{version.label || `版本 ${version.versionNumber}`}</strong><small>{new Date(version.createdAt).toLocaleString("zh-CN")} · {version.reason === "export" ? "导出前保存" : version.reason === "manual" ? "手动保存" : version.reason || "版本恢复"}</small></div><button onClick={() => void restore(version)} disabled={working}><ArchiveRestore aria-hidden="true" />恢复</button></article>) : <div className="utility-empty"><CheckCircle2 /><strong>暂无手动版本</strong><span>自动保存不会制造大量版本；手动保存或导出前才会建立快照。</span></div> : syncItems.length ? syncItems.map((item) => <article className="product-sync-row" key={item.clientId}><PackageCheck aria-hidden="true" /><div><strong>{item.latest.name}</strong><span>v{item.currentVersion} → v{item.latestVersion}</span><small>{item.fields.map((field) => fieldLabels[field] || field).join("、")}</small><div><button onClick={() => void applySync([{ clientId: item.clientId }])}>全部</button>{item.fields.includes("imageAssetId") && <button onClick={() => void applySync([{ clientId: item.clientId, fields: ["imageAssetId"] }])}><Image />图片</button>}{item.fields.includes("items") && <button onClick={() => void applySync([{ clientId: item.clientId, fields: ["items"] }])}>规格</button>}<button onClick={() => void applySync([{ clientId: item.clientId, fields: item.fields.filter((field) => !["marketPrice", "salePrice"].includes(field)) }])}>不更新价格</button><button onClick={() => void applySync([{ clientId: item.clientId, ignore: true }])}>忽略</button></div></div></article>) : <div className="utility-empty"><CheckCircle2 /><strong>商品已是最新</strong><span>项目使用独立快照；商品库后续更新只会在这里提示，不会自动覆盖。</span></div>}</div>
    </aside></div>;
}
