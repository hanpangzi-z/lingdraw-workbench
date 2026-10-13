import { useState } from 'react'
import { Check, ChevronDown, CircleAlert, Image as ImageIcon, Info, LoaderCircle, Play, RotateCcw, Sparkles } from 'lucide-react'

export type CanvasShape<TType extends string = string, TProps extends Record<string, unknown> = Record<string, unknown>> = {
  id: string
  type: TType
  x: number
  y: number
  rotation?: number
  parentId?: string
  props: TProps
}

export type DesignImageShape = CanvasShape<'design-image', {
  w: number
  h: number
  url: string
  name: string
  lineage: string
}>

export type GenerationPlaceholderShape = CanvasShape<'generation-placeholder', {
  w: number
  h: number
  status: 'generating' | 'failed'
  label: string
  placementId: string
}>

export type DesignGeneratorShape = CanvasShape<'design-generator', {
  w: number
  h: number
  status: 'configured' | 'running' | 'failed' | 'result'
  prompt: string
  model: string
  quality: string
  count: number
  cost: number
  resultUrl: string
  resultName: string
  lineage: string
  error: string
}>

export type DesignMarkerShape = CanvasShape<'design-marker', {
  w: number
  h: number
  number: number
  label: string
  targetShapeId: string
  targetName: string
  xRatio: number
  yRatio: number
  recognitionStatus: 'analyzing' | 'recognized' | 'failed'
  recognitionDescription: string
}>

export type CanvasShapeRecord =
  | DesignImageShape
  | GenerationPlaceholderShape
  | DesignGeneratorShape
  | DesignMarkerShape
  | CanvasShape

export function generatorOutcomeIsUnknown(status: DesignGeneratorShape['props']['status'], error: string, lineage: string) {
  if (status !== 'failed') return false
  let upstreamOutcome = ''
  try { upstreamOutcome = String(JSON.parse(lineage || '{}').upstreamOutcome || '') } catch { upstreamOutcome = '' }
  return upstreamOutcome === 'unknown'
    || /可能已经|可能已完成|没有自动重试|供应商操作日志|连接中断/.test(error)
}

function stopCanvasEvent(event: React.SyntheticEvent) {
  event.stopPropagation()
}

export function DesignGeneratorCard({
  shape,
  onUpdate,
}: {
  shape: DesignGeneratorShape
  onUpdate: (props: Partial<DesignGeneratorShape['props']>) => void
}) {
  const [showInfo, setShowInfo] = useState(false)
  const [openMenu, setOpenMenu] = useState<'model' | 'quality' | 'count' | ''>('')
  const outcomeUnknown = generatorOutcomeIsUnknown(shape.props.status, shape.props.error, shape.props.lineage)
  const run = () => {
    window.dispatchEvent(new CustomEvent('lingdraw:run-generator', { detail: { shapeId: shape.id } }))
  }

  if (shape.props.status === 'result' && shape.props.resultUrl) {
    return (
      <div className="design-generator result" id={shape.id}>
        <img src={shape.props.resultUrl} alt={shape.props.resultName || '生成结果'} draggable={false} />
        <button className="generator-info-button" onPointerDown={stopCanvasEvent} onClick={() => setShowInfo(value => !value)} aria-label="生成信息"><Info size={17} /></button>
        {showInfo && <section className="generator-info" onPointerDown={stopCanvasEvent}>
          <header><strong>生成信息</strong><button onClick={() => setShowInfo(false)}>×</button></header>
          <dl>
            <div><dt>提示词</dt><dd>{shape.props.prompt || '—'}</dd></div>
            <div><dt>模型</dt><dd>{shape.props.model || '自动选择'}</dd></div>
            <div><dt>尺寸</dt><dd>{Math.round(shape.props.w)} × {Math.round(shape.props.h)}</dd></div>
            <div><dt>质量</dt><dd>{shape.props.quality || '自动'}</dd></div>
          </dl>
        </section>}
      </div>
    )
  }

  return (
    <div className={`design-generator ${shape.props.status}`} id={shape.id}>
      <section className="generator-preview">
        {shape.props.status === 'running' ? <><LoaderCircle className="spin" /><strong>正在生成设计</strong><small>结果会留在当前位置</small></> :
          shape.props.status === 'failed' ? <><CircleAlert /><strong>{outcomeUnknown ? '生成结果待确认' : '生成失败'}</strong><small>{shape.props.error || '请检查模型配置后重试'}</small>{outcomeUnknown && <small>请先检查供应商记录；再次提交会创建新的付费任务。</small>}</> :
            <><span><ImageIcon size={28} /></span><strong>图像生成器</strong><small>输入描述后直接在画布中创作</small></>}
      </section>
      <section
        className="generator-config"
        onPointerDown={stopCanvasEvent}
        onKeyDown={stopCanvasEvent}
        onPaste={stopCanvasEvent}
        onCopy={stopCanvasEvent}
        onCut={stopCanvasEvent}
      >
        <textarea
          value={shape.props.prompt}
          disabled={shape.props.status === 'running'}
          onChange={event => onUpdate({ prompt: event.target.value })}
          placeholder="描述你想生成的画面、主体、风格和用途…"
        />
        <div className="generator-options">
          <GeneratorSelect label="模型" value={shape.props.model} options={[{ value: 'GPT Image', label: 'GPT Image' }, { value: '自动选择', label: '自动选择' }]} open={openMenu === 'model'} disabled={shape.props.status === 'running'} onToggle={() => setOpenMenu(value => value === 'model' ? '' : 'model')} onChange={value => { onUpdate({ model: value }); setOpenMenu('') }} />
          <GeneratorSelect label="质量" value={shape.props.quality} options={[{ value: 'auto', label: '自动' }, { value: 'high', label: '高清' }]} open={openMenu === 'quality'} disabled={shape.props.status === 'running'} onToggle={() => setOpenMenu(value => value === 'quality' ? '' : 'quality')} onChange={value => { onUpdate({ quality: value }); setOpenMenu('') }} />
          <GeneratorSelect label="数量" value={String(shape.props.count)} options={[{ value: '1', label: '1 张' }]} open={openMenu === 'count'} disabled={shape.props.status === 'running'} onToggle={() => setOpenMenu(value => value === 'count' ? '' : 'count')} onChange={value => { onUpdate({ count: Number(value) }); setOpenMenu('') }} />
        </div>
        <div className="generator-run-row">
          <span><Sparkles size={14} />预计 {shape.props.cost} 积分</span>
          <button disabled={!shape.props.prompt.trim() || shape.props.status === 'running'} onClick={run}>{shape.props.status === 'failed' ? <RotateCcw size={15} /> : <Play size={15} />}{outcomeUnknown ? '确认并新建付费任务' : shape.props.status === 'failed' ? '重试' : '开始生成'}</button>
        </div>
      </section>
    </div>
  )
}

function GeneratorSelect({ label, value, options, open, disabled, onToggle, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  open: boolean
  disabled: boolean
  onToggle: () => void
  onChange: (value: string) => void
}) {
  const current = options.find(option => option.value === value)?.label || value
  return <div className={`generator-select ${open ? 'open' : ''}`}>
    <button type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={onToggle}><span>{label}</span><strong>{current}</strong><ChevronDown size={13} /></button>
    {open && <div className="generator-select-menu" role="listbox" aria-label={`${label}选项`}>
      {options.map(option => <button type="button" key={option.value} role="option" aria-selected={option.value === value} onClick={() => onChange(option.value)}><span>{option.label}</span>{option.value === value && <Check size={13} />}</button>)}
    </div>}
  </div>
}
