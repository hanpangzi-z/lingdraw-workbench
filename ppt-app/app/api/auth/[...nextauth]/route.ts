import { withBasePath } from "@/src/lib/basePath";

export function GET(request: Request) {
  return Response.redirect(new URL(withBasePath("/login"), request.url), 307);
}

export function POST() {
  return Response.json({ error: "PPT 使用灵绘统一账号，独立登录已停用", code: "AUTH_OWNED_BY_LINGDRAW" }, { status: 410 });
}
