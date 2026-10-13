const DISPIMG_PATTERN = /(?:_xlfn\.)?DISPIMG\(\s*["']([^"']+)["']/i;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlAttributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)].map((match) => [match[1], decodeXml(match[3])]));
}

function normalizeZipPath(path: string) {
  const parts: string[] = [];
  path.replace(/\\/g, "/").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

function relationshipTarget(target: string) {
  return normalizeZipPath(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
}

function mimeType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

export function getDispImageId(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.match(DISPIMG_PATTERN)?.[1];
}

export function resolveExcelImageCell(value: unknown, embeddedImages: ReadonlyMap<string, string>) {
  const imageId = getDispImageId(value);
  if (!imageId) return value;
  return embeddedImages.get(imageId) ?? "";
}

/** Extracts WPS/Excel cell images referenced by DISPIMG formulas without resizing or recompressing them. */
export async function extractExcelEmbeddedImages(input: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(input);
  const cellImagesXml = await zip.file("xl/cellimages.xml")?.async("text");
  const relationshipsXml = await zip.file("xl/_rels/cellimages.xml.rels")?.async("text");
  if (!cellImagesXml || !relationshipsXml) return new Map<string, string>();

  const targets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const attributes = xmlAttributes(match[0]);
    if (attributes.Id && attributes.Target) targets.set(attributes.Id, relationshipTarget(attributes.Target));
  }

  const imageRecords: Array<{ imageId: string; relationshipId: string }> = [];
  for (const match of cellImagesXml.matchAll(/<etc:cellImage\b[\s\S]*?<\/etc:cellImage>/g)) {
    const nameTag = match[0].match(/<xdr:cNvPr\b[^>]*>/)?.[0];
    const blipTag = match[0].match(/<a:blip\b[^>]*>/)?.[0];
    if (!nameTag || !blipTag) continue;
    const imageId = xmlAttributes(nameTag).name;
    const relationshipId = xmlAttributes(blipTag)["r:embed"];
    if (imageId && relationshipId) imageRecords.push({ imageId, relationshipId });
  }

  const dataByRelationship = new Map<string, string>();
  await Promise.all([...new Set(imageRecords.map((record) => record.relationshipId))].map(async (relationshipId) => {
    const target = targets.get(relationshipId);
    const file = target ? zip.file(target) : undefined;
    if (!target || !file) return;
    const base64 = await file.async("base64");
    dataByRelationship.set(relationshipId, `data:${mimeType(target)};base64,${base64}`);
  }));

  return new Map(imageRecords.flatMap(({ imageId, relationshipId }) => {
    const source = dataByRelationship.get(relationshipId);
    return source ? [[imageId, source] as const] : [];
  }));
}
