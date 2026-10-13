import { Check } from "lucide-react";
import type { WorkflowStep } from "@/src/store/projectStore";

const baseSteps: Array<{ key: WorkflowStep; label: string; description: string }> = [
  { key: "upload", label: "上传资料", description: "Excel 与项目信息" },
  { key: "mapping", label: "字段匹配", description: "规则识别与人工修正" },
  { key: "confirm", label: "数据确认", description: "检查、编辑与排序" },
  { key: "preview", label: "PPT 预览", description: "生成与导出" },
];

export function WorkflowStepper({ current, batchMode = false }: { current: WorkflowStep; batchMode?: boolean }) {
  const steps = batchMode ? [
    ...baseSteps.slice(0, 3),
    { key: "batch" as const, label: "批量项目", description: "分组、检查与批量导出" },
    baseSteps[3],
  ] : baseSteps;
  const currentIndex = steps.findIndex((step) => step.key === current);
  return (
    <nav className="workflow-stepper" aria-label="创建产品手册进度">
      {steps.map((step, index) => {
        const completed = index < currentIndex;
        const active = index === currentIndex;
        return (
          <div className={`workflow-step ${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`} key={step.key} aria-current={active ? "step" : undefined}>
            <span>{completed ? <Check aria-hidden="true" /> : index + 1}</span>
            <div><strong>{step.label}</strong><small>{step.description}</small></div>
          </div>
        );
      })}
    </nav>
  );
}
