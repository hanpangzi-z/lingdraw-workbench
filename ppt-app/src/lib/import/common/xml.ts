export function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function textFromXml(xml: string, tagPattern = "(?:w:t|a:t)") {
  return [...xml.matchAll(new RegExp(`<${tagPattern}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagPattern}>`, "g"))]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getXmlAttribute(xml: string, attribute: string) {
  return xml.match(new RegExp(`${attribute}="([^"]*)"`))?.[1];
}

export function mimeFromFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "emf") return "image/emf";
  return "image/jpeg";
}

export function hashBytes(bytes: Uint8Array) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function readImageDimensions(bytes: Uint8Array, fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (["jpg", "jpeg"].includes(extension ?? "")) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: (bytes[offset + 7] << 8) + bytes[offset + 8], height: (bytes[offset + 5] << 8) + bytes[offset + 6] };
      }
      offset += Math.max(2, length + 2);
    }
  }
  return {};
}

export function resolvePartPath(baseDirectory: string, target: string) {
  const parts = `${baseDirectory}/${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}
