// Excalidraw 0.18.1 has no runtime translation override API. Complete its
// bundled locale during Vite transformation without editing node_modules.
const additions = {
  hints: {
    createFlowchart: '按住 CtrlOrCmd 并使用方向键创建流程图',
    enterCropEditor: '双击图片或按 ENTER 裁剪图片',
    leaveCropEditor: '点击图片外部，或按 ENTER 或 ESCAPE 完成裁剪',
  },
  labels: { imageCropping: '图片裁剪', unCroppedDimension: '裁剪前尺寸' },
  helpDialog: {
    createFlowchart: '从普通图形创建流程图', navigateFlowchart: '在流程图中导航',
    cropStart: '裁剪图片', cropFinish: '完成图片裁剪',
  },
};

export function completeChineseLocale(code, id) {
  if (!/\/node_modules\/@excalidraw\/excalidraw\/dist\/(dev|prod)\/locales\/zh-CN-[^/]+\.js$/.test(id.replaceAll('\\', '/').split('?')[0])) return null;
  const exportBlock = code.match(/export\s*\{([^}]+)\}/)?.[1];
  const name = exportBlock?.match(/\b([\w$]+)\s+as\s+default\b/)?.[1];
  if (!name) throw new Error('Excalidraw Chinese locale format changed; review translation overrides');
  const patch = Object.entries(additions).map(([group, values]) => `Object.assign(${name}.${group}, ${JSON.stringify(values)});`).join('\n');
  return `${code}\n${patch}\n`;
}

export function chineseLocalePlugin() {
  return { name: 'excalidraw-chinese-hints', enforce: 'pre', transform: completeChineseLocale };
}
