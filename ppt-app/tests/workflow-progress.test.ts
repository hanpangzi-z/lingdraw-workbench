import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatElapsed, WorkflowProgress, WorkflowNextAction } from "../components/workflow/WorkflowProgress";

describe("workflow waiting feedback", () => {
  it("formats actual elapsed time across minutes without negative seconds", () => {
    expect(formatElapsed(-1000)).toBe("0 秒");
    expect(formatElapsed(59999)).toBe("59 秒");
    expect(formatElapsed(60000)).toBe("1 分 0 秒");
    expect(formatElapsed(150000)).toBe("2 分 30 秒");
  });
  it("does not invent a percentage for work without measurable progress", () => {
    const html = renderToStaticMarkup(createElement(WorkflowProgress, { message: "正在加载字段匹配…" }));
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow');
    expect(html).toContain("暂无法准确预计剩余时间");
    expect(html).toContain("已用时 0 秒");
  });
  it("clamps actual phase progress and treats non-finite numbers as indeterminate", () => {
    for (const [percent, expected] of [[-20, 0], [44, 44], [110, 100]]) {
      const html = renderToStaticMarkup(createElement(WorkflowProgress, { message: "正在上传", percent }));
      expect(html).toContain(`aria-valuenow="${expected}"`);
      expect(html).toContain("不是整体进度");
    }
    const html = renderToStaticMarkup(createElement(WorkflowProgress, { message: "正在处理", percent: NaN }));
    expect(html).not.toContain('aria-valuenow');
  });
  it("does not start processing or show an active timer while idle", () => {
    let calls = 0;
    const html = renderToStaticMarkup(createElement(WorkflowNextAction, { label: "下一步", message: "正在处理", disabled: true, action: () => { calls++; } }));
    expect(calls).toBe(0);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('role="progressbar"');
  });
});
