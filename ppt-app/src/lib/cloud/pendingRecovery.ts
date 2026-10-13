import { writeDraft } from "./localDraft";

export interface PendingRecoveryState {
  files: File[];
  created?: unknown;
  imageUploads?: Record<string, string>;
  sourceUploadedIndices?: number[];
  sourceFilesComplete?: boolean;
  projectDeleted?: boolean;
}

export function draftForNewProject<T extends PendingRecoveryState>(draft: T): T {
  if (!draft.sourceFilesComplete) throw new Error("旧草稿可能缺少源文件，请先补选全部原始资料，不会重新解析或清空编辑内容。");
  return { ...draft, created: undefined, imageUploads: {}, sourceUploadedIndices: [], projectDeleted: false };
}

/** The old recovery pointer remains valid until the new draft is durably saved. */
export async function prepareRecoveredDraft<T extends PendingRecoveryState>(
  slot: string,
  draft: T,
  setPointer: (slot: string, creationKey: string) => void,
) {
  const next = draftForNewProject(draft);
  const creationKey = crypto.randomUUID();
  const key = `${slot}:${creationKey}`;
  await writeDraft(key, next);
  setPointer(slot, creationKey);
  return { key, creationKey, draft: next };
}
