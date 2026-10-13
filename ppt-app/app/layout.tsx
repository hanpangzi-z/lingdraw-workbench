import type { Metadata } from "next";
import "./globals.css";
import "./cloud.css";
import "./library.css";
import "./lingdraw.css";
import { LingDrawBridge } from "@/components/host/LingDrawBridge";
import { PptDomLocalizer } from "@/components/host/PptDomLocalizer";
import { StudioDialogProvider } from "@/components/host/StudioDialogProvider";

export const metadata: Metadata = {
  title: "PPT — 灵绘",
  description: "灵绘 PPT 项目、商品、模板与演示文稿工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><StudioDialogProvider><LingDrawBridge /><PptDomLocalizer />{children}</StudioDialogProvider></body>
    </html>
  );
}
