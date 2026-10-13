import type { CloudProjectSnapshot } from "@/src/server/projects/types";

export type SaveReceipt = { revision: number; snapshot: CloudProjectSnapshot };
export type SaveResult = ({ ok: true } & SaveReceipt) | { ok: false; message: string };

export function requireSaved(result: SaveResult): SaveReceipt {
  if (!result.ok) throw new Error(result.message);
  return result;
}

export function recoveryAction(localRevision: number, remoteRevision: number, hasLocalChanges: boolean) {
  if (remoteRevision <= localRevision) return "keep";
  return hasLocalChanges ? "conflict" : "restore";
}
