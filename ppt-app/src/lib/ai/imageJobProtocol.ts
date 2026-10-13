export interface ImageJobResult { imageUrl: string; outputSize?: string }
export interface ImageJobProgress { message: string; elapsedSeconds: number }
export class ImageJobPendingError extends Error {
  constructor(public readonly jobId: string, message = "查询暂时中断，任务编号已保留；请继续查询，不要重复生成", public readonly stopPolling = false) { super(message); }
}
export class ImageJobFailedError extends Error {}
