import { useProjectStore } from '@/src/store/projectStore';
export function CatalogWorkflow({ stagedFiles }) {
  const state = useProjectStore();
  return <article><h2>实际草稿组件 / 流程状态探针</h2><p>步骤：{state.step}</p><p>商品数：{state.products.length}</p><p>编辑商品：{state.products[0]?.name || '无'}</p><p>源文件：{stagedFiles.map(file => `${file.name} (${file.size} bytes)`).join(', ') || '无'}</p><p>图片：{state.products[0]?.image?.startsWith('data:') ? '完整恢复' : '无'}</p></article>;
}
