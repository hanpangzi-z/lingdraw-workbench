export type ImageScenePreset = "office" | "camping" | "home";

export const MAX_IMAGE_REFERENCES = 10;

export interface ImageSceneTemplate {
  id: ImageScenePreset;
  label: string;
  description: string;
}

export const IMAGE_SCENE_TEMPLATES: ImageSceneTemplate[] = [
  { id: "office", label: "办公场景", description: "冷白自然光 · 黑白灰现代办公桌" },
  { id: "camping", label: "野营场景", description: "清晨自然光 · 草地帐篷与青山" },
  { id: "home", label: "家庭场景", description: "午后暖光 · 原木茶几与居家氛围" },
];

export function createImageScenePrompt(preset: ImageScenePreset, productName: string) {
  const fullName = productName.trim() || "商品";
  if (preset === "office") {
    return `极简办公场景，【${fullName}】放在【笔记本电脑旁】，周围有【黑色皮质笔记本、银色钢笔、白色陶瓷马克杯、一小盆绿萝】。干净整洁的白色桌面，冷白色自然光，简约高级的现代风格。整体色调以黑白灰为主，点缀少量绿色。8K超高清分辨率，画面干净利落，质感高级，轻微景深效果，突出产品主体。`;
  }
  if (preset === "camping") {
    return `治愈露营场景，【${fullName}】放在【露营折叠桌】上，周围有【不锈钢水杯、复古煤油灯、一本露营指南】。背景是【绿色的草地、白色的帐篷、远处的青山和蓝天】。清晨柔和的自然光，空气清新，氛围宁静治愈。8K超高清分辨率，自然色彩鲜艳，细节丰富，大光圈浅景深效果，突出产品主体。`;
  }
  return `温馨居家场景，【${fullName}】摆放在【客厅原木茶几】上，周围有【米色针织抱枕、翻开的时尚杂志、一小盆绿色多肉植物】。午后柔和的阳光透过白色纱帘洒进来，在桌面上形成斑驳的光影。暖色调，整体氛围慵懒舒适，充满生活气息。8K超高清分辨率，细节丰富，质感真实，轻微景深效果，突出产品主体。`;
}

export function selectImageReferences(sources: Array<string | undefined>, limit = MAX_IMAGE_REFERENCES) {
  return [...new Set(sources.map((source) => source?.trim()).filter((source): source is string => Boolean(source)))].slice(0, limit);
}
