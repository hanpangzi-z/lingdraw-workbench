export class AppError extends Error {
  constructor(message: string, public readonly status = 500, public readonly code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "请先登录") { super(message, 401, "UNAUTHORIZED"); }
}

export class ForbiddenError extends AppError {
  constructor(message = "无权访问该项目") { super(message, 403, "FORBIDDEN"); }
}

export class NotFoundError extends AppError {
  constructor(message = "记录不存在") { super(message, 404, "NOT_FOUND"); }
}

export class ProjectDeletedError extends AppError {
  constructor() { super("项目已删除", 404, "PROJECT_DELETED"); }
}

export class ConflictError extends AppError {
  constructor(message = "项目已在其他会话中更新，请刷新后重试") { super(message, 409, "REVISION_CONFLICT"); }
}

export class ResourceConflictError extends AppError {
  constructor(message = "资源正在使用，无法删除") { super(message, 409, "RESOURCE_IN_USE"); }
}

export class ValidationError extends AppError {
  constructor(message: string) { super(message, 400, "VALIDATION_ERROR"); }
}

export class AIServiceError extends AppError {
  constructor(message: string, status = 502) { super(message, status, "AI_BRIDGE_ERROR"); }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[Server] 未处理异常", error);
  return Response.json({ error: "服务暂时不可用，请稍后重试", code: "INTERNAL_ERROR" }, { status: 500 });
}
