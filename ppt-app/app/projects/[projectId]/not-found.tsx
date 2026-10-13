import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <main className="project-not-found">
      <span>404 / 项目</span>
      <h1>找不到该项目</h1>
      <p>项目可能已被删除，或者它属于其他账号。</p>
      <Link href="/projects">返回我的项目</Link>
    </main>
  );
}
