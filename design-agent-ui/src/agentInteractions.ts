export const IMAGE_EDIT_ESTIMATED_COST = 14

export const QUICK_EDIT_PRESETS = [
  { label: '灯光', instruction: '将光线调整为柔和自然的商业日光，增强主体材质和层次。' },
  { label: '食欲表现', instruction: '增强食物的色泽、蒸汽和新鲜质感，同时保持画面真实自然。' },
  { label: '搭配元素', instruction: '补充与主体和品牌风格协调的搭配元素，不遮挡核心信息。' },
  { label: '场景', instruction: '优化背景场景与空间氛围，保持主体、文字和构图关系不变。' },
] as const

export function appendPromptInstruction(current: string, instruction: string) {
  const existing = current.trimEnd()
  const next = instruction.trim()
  if (!next) return existing
  return existing ? `${existing}\n${next}` : next
}
