import { randomUUID } from "node:crypto";
import { getPrisma } from "@/src/server/db/prisma";
import { getStorageProvider } from "@/src/lib/storage";
import type { CloudProjectSnapshot } from "./types";

const escapeXml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

function safeColor(value?: string) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value! : "#B51F32";
}

function titleLines(title: string) {
  const characters = Array.from(title.trim() || "未命名产品手册");
  const first = characters.slice(0, 18).join("");
  const second = characters.slice(18, 36).join("");
  return [first, second].filter(Boolean);
}

function createCoverSvg(snapshot: CloudProjectSnapshot) {
  const meta = snapshot.project;
  const primary = safeColor(meta.design.brandColor || (meta.design.themeOverrides as { colors?: { primary?: string } } | undefined)?.colors?.primary);
  const lines = titleLines(meta.title || meta.projectName);
  const productCount = snapshot.products.length;
  const categoryCount = new Set(snapshot.products.map((product) => product.categoryId)).size;
  const regionAndTier = [meta.city, meta.tierName || (meta.priceTier ? `${meta.priceTier}元档位` : "")].filter(Boolean).join(" · ");
  const title = lines.map((line, index) => `<text x="92" y="${252 + index * 72}" font-size="54" font-weight="700" fill="#18191d">${escapeXml(line)}</text>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f7f4ef"/>
  <rect x="0" y="0" width="1280" height="28" fill="${primary}"/>
  <circle cx="1130" cy="160" r="238" fill="${primary}" opacity=".08"/>
  <circle cx="1168" cy="604" r="160" fill="${primary}" opacity=".12"/>
  <rect x="92" y="100" width="52" height="8" rx="4" fill="${primary}"/>
  <text x="160" y="114" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="22" font-weight="700" letter-spacing="4" fill="${primary}">灵绘 PPT / ${escapeXml(meta.year)}</text>
  <g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif">${title}</g>
  <text x="94" y="${lines.length > 1 ? 430 : 358}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="24" fill="#686a70">${escapeXml(meta.subtitle || regionAndTier || "产品手册")}</text>
  <line x1="92" y1="510" x2="720" y2="510" stroke="#d9d3ca" stroke-width="2"/>
  <text x="94" y="558" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="20" fill="#686a70">${escapeXml(regionAndTier)}</text>
  <text x="94" y="620" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="20" font-weight="700" fill="${primary}">${productCount} 款商品</text>
  <text x="240" y="620" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="20" fill="#686a70">${categoryCount} 个分类</text>
  <rect x="925" y="492" width="238" height="122" rx="10" fill="${primary}"/>
  <text x="1044" y="542" text-anchor="middle" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="17" letter-spacing="3" fill="#fff" opacity=".8">PRODUCT CATALOG</text>
  <text x="1044" y="590" text-anchor="middle" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="32" font-weight="700" fill="#fff">${escapeXml(meta.brand || meta.design.brandName || "灵绘")}</text>
</svg>`;
}

export async function refreshProjectThumbnail(userId: string, projectId: string, snapshot: CloudProjectSnapshot) {
  const storage = getStorageProvider();
  const bytes = new TextEncoder().encode(createCoverSvg(snapshot));
  const storageKey = `${userId}/${projectId}/thumbnail/${randomUUID()}.svg`;
  await storage.upload({ key: storageKey, data: bytes, mimeType: "image/svg+xml" });

  try {
    const asset = await getPrisma().asset.create({
      data: {
        userId,
        type: "thumbnail",
        fileName: "cover-thumbnail.svg",
        storageKey,
        mimeType: "image/svg+xml",
        size: BigInt(bytes.byteLength),
        width: 1280,
        height: 720,
        metadata: { generatedFrom: "cover", pageRatio: "16:9" },
        projectLinks: { create: { projectId, role: "thumbnail" } },
      },
    });

    await getPrisma().project.update({
      where: { id: projectId },
      data: { thumbnailAssetId: asset.id, thumbnailUrl: null, thumbnailDirty: false },
    });

    const obsolete = await getPrisma().projectAsset.findMany({
      where: { projectId, role: "thumbnail", assetId: { not: asset.id } },
      include: { asset: true },
    });
    if (obsolete.length) {
      await getPrisma().projectAsset.deleteMany({ where: { projectId, role: "thumbnail", assetId: { in: obsolete.map((link) => link.assetId) } } });
      for (const link of obsolete) {
        const references = await getPrisma().projectAsset.count({ where: { assetId: link.assetId } });
        if (!references) {
          await storage.delete(link.asset.storageKey).catch(() => undefined);
          await getPrisma().asset.delete({ where: { id: link.assetId } }).catch(() => undefined);
        }
      }
    }
    return asset.id;
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}
