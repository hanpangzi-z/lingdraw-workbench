"use client";

import { useEffect } from "react";
import { LogIn, Presentation } from "lucide-react";

function openLingDrawLogin() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "ppt:auth-required" }, window.location.origin);
  } else {
    window.location.replace("/login");
  }
}

export function AuthRequiredPage() {
  useEffect(openLingDrawLogin, []);
  return <main className="ppt-auth-required">
    <span><Presentation aria-hidden="true" /></span>
    <h1>需要登录灵绘</h1>
    <p>PPT 工作台使用灵绘账号，无需单独注册。</p>
    <button type="button" onClick={openLingDrawLogin}><LogIn aria-hidden="true" />前往登录</button>
  </main>;
}
