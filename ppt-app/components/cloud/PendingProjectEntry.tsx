"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PendingProjectWorkspace } from "./PendingProjectWorkspace";
import { savedDraftIds } from "@/src/lib/cloud/draftIdentity";

export function PendingProjectEntry({ userId, initialName, draftId, layoutDebug }: { userId: string; initialName: string; draftId?: string; layoutDebug?: boolean }) {
  const router = useRouter();
  const [previous, setPrevious] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    try { const ids = savedDraftIds(sessionStorage, `ppt-pending:${userId}:${initialName}`); setHistory(ids); setPrevious(ids[0] || null); }
    catch { setError(true); }
    setChecked(true);
  }, [userId, initialName]);
  const open = (id: string) => {
    if (opening) return;
    setOpening(true);
    const query = new URLSearchParams({ draft: id });
    if (initialName === "新导入项目") query.set("intent", "import");
    router.replace(`/projects/new?${query}`);
  };
  if (draftId) return <PendingProjectWorkspace key={`${userId}:${initialName}:${draftId}`} userId={userId} initialName={initialName} draftId={draftId} layoutDebug={layoutDebug} />;
  if (!checked) return <div className="pending-draft-entry">正在检查本机草稿…</div>;
  if (error) return <div className="pending-draft-entry" role="alert">无法读取本机草稿入口，请检查浏览器存储权限后重试。原草稿未删除。</div>;
  return <section className="pending-draft-entry" aria-label="选择新建或恢复草稿">
    <h1>新建项目</h1>
    <p>{previous ? "发现上次未完成的本机草稿。新建空白项目将从上传资料开始，不会沿用旧商品或旧项目编号。" : "创建空白项目，从上传资料开始。"}</p>
    <button type="button" disabled={opening} onClick={() => open(crypto.randomUUID())}>新建空白项目</button>
    {previous && <><label>本机保留的草稿<select disabled={opening} value={previous} onChange={event => setPrevious(event.target.value)}>{history.map((id, index) => <option key={id} value={id}>{index === 0 ? "最近草稿" : "较早草稿"} · {id.slice(-8)}</option>)}</select></label><button type="button" disabled={opening} onClick={() => open(previous)}>继续所选草稿</button></>}
    <p>新建不会删除旧草稿，可从此列表继续。刷新当前项目只恢复当前草稿。</p>
  </section>;
}
