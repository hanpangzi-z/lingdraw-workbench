// IndexedDB's per-message limit applies to serialized strings, not just file sizes.
// Keep the object graph small; deduplicate large values and store bytes in Blob parts.
export const DRAFT_PART_BYTES = 4 * 1024 * 1024;
type Value = null | boolean | number | string | { ref: number };
type Node = { kind: string; entries?: [string, Value][]; items?: Value[]; asset?: string; value?: string; mime?: string; name?: string; modified?: number };
type Graph = { root: Value; nodes: Node[] };
export type EncodedDraft = { metadata: Blob; assets: Map<string, Blob> };
const hashes = new WeakMap<Blob, Promise<string>>();

async function digest(blob: Blob) {
  let pending = hashes.get(blob);
  if (!pending) {
    pending = blob.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(hash => Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""));
    hashes.set(blob, pending);
    pending.catch(() => hashes.delete(blob));
  }
  return pending;
}

function decodeBase64(text: string, offset: number) {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let start = offset; start < text.length; start += 65536) {
    const binary = atob(text.slice(start, start + 65536));
    parts.push(Uint8Array.from(binary, character => character.charCodeAt(0)));
  }
  return new Blob(parts);
}

async function encodeBase64(blob: Blob) {
  const parts: string[] = [];
  // Multiple of three so only the final part has padding.
  for (let start = 0; start < blob.size; start += 49152) {
    parts.push(btoa(String.fromCharCode(...new Uint8Array(await blob.slice(start, start + 49152).arrayBuffer()))));
  }
  return parts.join("");
}

export async function encodeDraft(input: unknown): Promise<EncodedDraft> {
  const nodes: Node[] = [];
  const objects = new WeakMap<object, number>();
  const strings = new Map<string, number>();
  const assets = new Map<string, Blob>();
  const asset = async (blob: Blob) => { const id = await digest(blob); if (!assets.has(id)) assets.set(id, blob); return id; };
  async function visit(value: unknown): Promise<Value> {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value === "string" && value.length < 32768 && !value.startsWith("blob:") && !value.startsWith("data:image/")) return value;
    const prior = typeof value === "string" ? strings.get(value) : value && typeof value === "object" ? objects.get(value) : undefined;
    if (prior !== undefined) return { ref: prior };
    const id = nodes.length;
    nodes.push({ kind: "undefined" });
    if (typeof value === "string") strings.set(value, id);
    if (value && typeof value === "object") objects.set(value, id);
    let node: Node;
    if (typeof value === "string") {
      const prefix = value.match(/^data:image\/[^;,]+;base64,/i)?.[0];
      if (value.startsWith("blob:")) {
        const response = await fetch(value);
        if (!response.ok) throw new Error("本地图片读取失败，请重新选择图片");
        const blob = await response.blob();
        node = { kind: "data-url", asset: await asset(blob), value: `data:${blob.type || "application/octet-stream"};base64,` };
      } else if (prefix) node = { kind: "data-url", asset: await asset(decodeBase64(value, prefix.length)), value: prefix };
      else node = { kind: "text", asset: await asset(new Blob([JSON.stringify(value)])) };
    } else if (value === undefined) node = { kind: "undefined" };
    else if (typeof value === "number") node = { kind: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    else if (typeof value === "bigint") node = { kind: "bigint", value: String(value) };
    else if (value instanceof Date) node = { kind: "date", value: String(value.getTime()) };
    else if (value instanceof File) node = { kind: "file", asset: await asset(value), mime: value.type, name: value.name, modified: value.lastModified };
    else if (value instanceof Blob) node = { kind: "blob", asset: await asset(value), mime: value.type };
    else if (value instanceof ArrayBuffer) node = { kind: "buffer", asset: await asset(new Blob([value])) };
    else if (ArrayBuffer.isView(value)) node = { kind: "view", asset: await asset(new Blob([new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()])), value: value.constructor.name };
    else if (Array.isArray(value)) { const items: Value[] = []; for (const child of value) items.push(await visit(child)); node = { kind: "array", items }; }
    else if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      const entries: [string, Value][] = [];
      for (const [key, child] of Object.entries(value)) entries.push([key, await visit(child)]);
      node = { kind: "object", entries };
    } else throw new Error("草稿包含不支持的数据类型，原草稿未覆盖");
    nodes[id] = node;
    return { ref: id };
  }
  const root = await visit(input);
  return { metadata: new Blob([JSON.stringify({ root, nodes } satisfies Graph)]), assets };
}

export async function decodeDraft<T>(metadata: Blob, assets: Map<string, Blob>): Promise<T> {
  const graph = JSON.parse(await metadata.text()) as Graph;
  const decoded = new Map<number, unknown>();
  async function visit(value: Value): Promise<unknown> {
    if (!value || typeof value !== "object") return value;
    if (decoded.has(value.ref)) return decoded.get(value.ref);
    const node = graph.nodes[value.ref];
    if (!node) throw new Error("草稿记录不完整，原草稿已保留");
    const blob = node.asset ? assets.get(node.asset) : undefined;
    if (node.asset && !blob) throw new Error("草稿附件不完整，原草稿已保留");
    let result: unknown;
    switch (node.kind) {
      case "object": {
        const object = {}; decoded.set(value.ref, object);
        for (const [key, child] of node.entries!) Object.defineProperty(object, key, { value: await visit(child), enumerable: true, writable: true, configurable: true });
        result = object; break;
      }
      case "array": {
        const array: unknown[] = []; decoded.set(value.ref, array);
        for (const child of node.items!) array.push(await visit(child));
        result = array; break;
      }
      case "undefined": result = undefined; break;
      case "number": result = Number(node.value); break;
      case "bigint": result = BigInt(node.value!); break;
      case "date": result = new Date(Number(node.value)); break;
      case "text": result = JSON.parse(await blob!.text()); break;
      case "data-url": result = node.value + await encodeBase64(blob!); break;
      case "file": result = new File([blob!], node.name!, { type: node.mime, lastModified: node.modified }); break;
      case "blob": result = blob!.slice(0, blob!.size, node.mime); break;
      case "buffer": result = await blob!.arrayBuffer(); break;
      case "view": {
        const constructors = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
        const Constructor = constructors[node.value as keyof typeof constructors];
        if (!Object.hasOwn(constructors, node.value!)) throw new Error("草稿二进制类型不受支持");
        result = new (Constructor as new (buffer: ArrayBuffer) => ArrayBufferView)(await blob!.arrayBuffer()); break;
      }
      default: throw new Error("草稿格式不受支持，原草稿已保留");
    }
    decoded.set(value.ref, result);
    return result;
  }
  return await visit(graph.root) as T;
}
