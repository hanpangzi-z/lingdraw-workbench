import { pptFetch } from "@/src/lib/basePath";
import type { CloudProjectSnapshot, ProjectDetailDto } from "@/src/server/projects/types";
import { compactAssetReferences } from "@/src/server/projects/snapshot";
import { rawDataWithProductComponents, withDerivedProductComponents } from "@/src/lib/catalog/components";
import { CloudApiError, isUncertainResponse, readCloudResponse, recoverCloudResult } from "./apiError";

const request = async <T>(url: string, action: string, init?: RequestInit) => {
  try { return await readCloudResponse<T>(await pptFetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) }), action); }
  catch (error) {
    if (error instanceof CloudApiError || !isUncertainResponse(error)) throw error;
    throw new CloudApiError(`${action}连接中断，当前资料已保留，请保留页面后重试`, 0, "NETWORK_ERROR");
  }
};
const invalidResponse = () => new CloudApiError("服务器返回的数据不完整，当前资料已保留", 200, "INVALID_RESPONSE");
function requireProject(project: ProjectDetailDto) {
  if (!project || typeof project.id !== "string" || !Number.isInteger(project.revision) || project.revision < 1 || !project.snapshot) throw invalidResponse();
  return project;
}

export async function createPendingProject(creationKey: string, name: string, progress: (message: string) => void) {
  const lookup = async () => {
    const result = await request<{ project: ProjectDetailDto | null }>(`/api/projects?creationKey=${encodeURIComponent(creationKey)}`, "核对项目");
    if (result.project === null) return undefined;
    return requireProject(result.project);
  };
  // A refresh/manual retry must recover the same creation identity first.
  const existing = await lookup();
  if (existing) return existing;
  try {
    return requireProject(await request<ProjectDetailDto>("/api/projects", "创建项目", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, creationKey }) }));
  } catch (error) {
    if (!isUncertainResponse(error)) throw error;
    return recoverCloudResult(lookup, "创建项目", progress);
  }
}

/** Conservative read-back comparison. Extra server-derived fields may prevent
 * recovery, but never accept a different edited snapshot just because its revision advanced. */
export function sameSavedSnapshot(expected: CloudProjectSnapshot, actual: CloudProjectSnapshot) {
  const normalized = (snapshot: CloudProjectSnapshot, persisted = false) => ({ ...snapshot, products: snapshot.products.map(product => {
    // These are exactly the derived/default fields introduced by productData /
    // hydrateProduct. Components remain compared through their persisted rawData.
    const { components: _components, image: _image, ...fields } = product;
    return { ...fields, price: withDerivedProductComponents(product).price, featured: Boolean(product.featured), images: (product.images?.length ? product.images : product.image ? [product.image] : []).filter(Boolean), rawData: persisted ? product.rawData : rawDataWithProductComponents(product) };
  }) });
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined && child !== null)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
    return value;
  };
  return JSON.stringify(stable(compactAssetReferences(normalized(expected)))) === JSON.stringify(stable(compactAssetReferences(normalized(actual, true))));
}

export async function savePendingProject(project: Pick<ProjectDetailDto, "id" | "revision">, snapshot: CloudProjectSnapshot, progress: (message: string) => void) {
  const url = `/api/projects/${project.id}`;
  const lookup = async () => {
    const remote = requireProject(await request<ProjectDetailDto>(url, "核对保存结果"));
    if (remote.id !== project.id) throw invalidResponse();
    if (remote.revision === project.revision) return undefined;
    if (remote.revision === project.revision + 1 && sameSavedSnapshot(snapshot, remote.snapshot)) return { revision: remote.revision };
    throw new CloudApiError("云端项目版本已变化，不能自动覆盖。当前资料已保留，请先在项目列表核对已保存内容", 409, "REVISION_CONFLICT");
  };
  // This also handles refresh after a committed PUT whose response was lost.
  const existing = await lookup();
  if (existing) return existing;
  try {
    const saved = await request<{ revision: number }>(url, "保存项目", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: project.revision, snapshot }) });
    if (saved.revision !== project.revision + 1) throw invalidResponse();
    return saved;
  } catch (error) {
    if (!isUncertainResponse(error) && !(error instanceof CloudApiError && error.status === 409)) throw error;
    return recoverCloudResult(lookup, "保存项目", progress);
  }
}
