"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Presentation } from "lucide-react";
import { PPT_BASE_PATH } from "@/src/lib/basePath";
import { usePptI18n } from "@/components/host/PptDomLocalizer";

export function ResourceNavigation() {
  const { t } = usePptI18n();
  const nav = [
    { href: "/projects", label: t("项目", "Projects") },
    { href: "/products", label: t("商品库", "Products") },
    { href: "/templates", label: t("模板库", "Templates") },
    { href: "/assets", label: t("素材库", "Assets") },
  ];
  const pathname = usePathname();
  const appPathname = pathname.startsWith(`${PPT_BASE_PATH}/`)
    ? pathname.slice(PPT_BASE_PATH.length)
    : pathname;
  return (
    <header className="projects-topbar resource-topbar">
      <Link className="projects-brand" href="/projects">
        <span>
          <Presentation aria-hidden="true" />
        </span>
        <div>
          <strong>灵绘</strong>
          <small>{t("PPT 工作台", "PPT Workspace")}</small>
        </div>
      </Link>
      <nav aria-label={t("PPT 工作台主导航", "PPT workspace navigation")}>
        {nav.map((item) => {
          const active = appPathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              className={active ? "is-active" : ""}
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
