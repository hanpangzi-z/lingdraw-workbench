import { describe, expect, it } from 'vitest'
import { appendPromptInstruction } from './agentInteractions'

describe('Agent follow-up drafting', () => {
  it('fills an empty draft with the full action instruction', () => {
    expect(appendPromptInstruction('', '增加动态标题留白')).toBe('增加动态标题留白')
  })

  it('appends repeated actions instead of replacing the current draft', () => {
    const first = appendPromptInstruction('保留包装主体', '增加动态标题留白')
    const second = appendPromptInstruction(first, '生成动态竖版延展')
    expect(second).toBe('保留包装主体\n增加动态标题留白\n生成动态竖版延展')
  })

  it('does not add an empty instruction', () => {
    expect(appendPromptInstruction('已有草稿  ', '   ')).toBe('已有草稿')
  })
})
