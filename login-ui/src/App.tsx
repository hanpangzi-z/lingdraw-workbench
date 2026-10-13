import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Eye, EyeOff, Menu, X } from 'lucide-react'
import lingDrawLogo from './assets/lingdraw-logo-white.png'
import { ShinyText } from './components/ShinyText'

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_105406_16f4600d-7a92-4292-b96e-b19156c7830a.mp4'

type AuthStatus = {
  authenticated: boolean
  setup_required: boolean
  username: string
}

const navItems = ['接单平台']

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)
  const creatingAccount = setupRequired || registering

  useEffect(() => {
    fetch('/api/auth/status', { cache: 'no-store' })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then((status) => {
        if (status.authenticated) {
          window.location.replace('/')
          return
        }
        setSetupRequired(status.setup_required)
        setReady(true)
        requestAnimationFrame(() => usernameRef.current?.focus())
      })
      .catch(() => {
        setMessage('无法连接登录服务，请稍后重试。')
        setReady(true)
      })
  }, [])

  const focusLogin = () => usernameRef.current?.focus()

  const switchAuthMode = () => {
    setRegistering((value) => !value)
    setPassword('')
    setConfirmPassword('')
    setMessage('')
    setSuccess(false)
    requestAnimationFrame(() => usernameRef.current?.focus())
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    setSuccess(false)

    if (username.trim().length < 2) {
      setMessage('用户名至少需要 2 个字符。')
      usernameRef.current?.focus()
      return
    }
    if (password.length < 8) {
      setMessage('密码至少需要 8 个字符。')
      return
    }
    if (creatingAccount && password !== confirmPassword) {
      setMessage('两次输入的密码不一致。')
      return
    }

    setSubmitting(true)
    try {
      const endpoint = setupRequired ? '/api/auth/setup' : registering ? '/api/auth/register' : '/api/auth/login'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || '验证失败，请检查账号信息。')
      if (registering && data.status === 'pending') {
        setSuccess(true)
        setMessage(data.message || '注册成功，请等待管理员审核。')
        setRegistering(false)
        setPassword('')
        setConfirmPassword('')
        setSubmitting(false)
        return
      }
      setSuccess(true)
      setMessage('验证成功，正在进入工作台…')
      window.setTimeout(() => window.location.replace('/'), 280)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '验证失败，请检查账号信息。')
      setSubmitting(false)
    }
  }

  return (
    <main className="relative h-screen overflow-y-auto bg-black font-sans text-white selection:bg-[#22D3EE] selection:text-[#0F172A]">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.2),rgba(0,0,0,.05)_42%,rgba(0,0,0,.66))]" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 sm:px-8 lg:px-10">
        <header className="flex h-20 shrink-0 items-center justify-between lg:h-24">
          <a href="#" className="flex shrink-0 items-center" aria-label="灵绘 LingDraw 首页">
            <img src={lingDrawLogo} alt="灵绘 LingDraw" className="h-11 w-auto object-contain sm:h-12" />
          </a>

          <nav className="hidden items-center gap-1 rounded-full border border-[#3B82F6]/35 bg-[#0F172A]/35 p-1.5 backdrop-blur-md lg:flex" aria-label="主导航">
            {navItems.map((item) => (
              <a key={item} href="#auth" onClick={focusLogin} className="rounded-full px-5 py-2 text-sm text-white/80 transition-colors duration-200 hover:text-white">
                {item}
              </a>
            ))}
          </nav>

          <button
            type="button"
            className="grid size-10 place-items-center rounded-full border border-[#3B82F6]/40 bg-[#0F172A]/35 text-white transition-colors hover:border-[#22D3EE]/70 lg:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="切换导航菜单"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>

        <AnimatePresence>
          {mobileOpen && (
            <motion.nav
              className="absolute top-20 right-5 left-5 z-30 rounded-3xl border border-white/15 bg-black/85 p-3 backdrop-blur-xl lg:hidden"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {navItems.map((item) => (
                <a key={item} href="#auth" onClick={() => setMobileOpen(false)} className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white">
                  {item}
                </a>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>

        <section className="flex flex-1 items-center justify-center py-8 sm:py-10 lg:py-6">
          <motion.div
            className="flex w-full max-w-5xl flex-col items-center text-center"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0, y: 28 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.8, delay: 0.18, staggerChildren: 0.08 } },
            }}
          >
            <motion.h1 variants={{ hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0 } }} className="leading-[.88] font-medium tracking-tighter">
              <ShinyText className="text-6xl sm:text-7xl md:text-8xl xl:text-9xl" baseColor="#7C3AED" middleColor="#3B82F6" endColor="#22D3EE" shineColor="#ffffff" speed={3} spread={100}>
                灵绘
              </ShinyText>
              <span className="mt-4 block whitespace-nowrap text-base font-normal tracking-[.16em] text-white sm:text-lg md:text-xl xl:text-2xl">让创意 一句话成真</span>
            </motion.h1>

            <motion.form
              id="auth"
              onSubmit={submit}
              variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
              className="mt-7 w-full max-w-2xl rounded-[1.65rem] border border-[#3B82F6]/30 bg-[#0F172A]/75 p-4 text-left shadow-[0_24px_70px_rgba(15,23,42,.42)] backdrop-blur-xl sm:p-5"
            >
              <div className="mb-4 flex items-start justify-between gap-4 px-1">
                <div>
                  <p className="text-xs font-medium tracking-[.16em] text-[#22D3EE]/80 uppercase">{setupRequired ? '首次使用' : registering ? '创建账号' : '安全访问'}</p>
                  <h2 className="mt-1 text-lg font-medium text-white">{setupRequired ? '创建管理员账号' : registering ? '注册 DesignPro' : '登录 DesignPro'}</h2>
                </div>
                <span className="mt-1 size-2 rounded-full bg-[#22D3EE] shadow-[0_0_18px_rgba(34,211,238,.8)]" />
              </div>

              <div className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className="px-1 text-[10px] font-medium tracking-[.14em] text-white/60 uppercase">用户名</span>
                  <input
                    ref={usernameRef}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={!ready || submitting}
                    autoComplete="username"
                    minLength={2}
                    maxLength={40}
                    placeholder="请输入用户名"
                    className="h-12 rounded-xl border border-[#CBD5E1]/20 bg-[#475569]/20 px-4 text-sm text-white outline-none transition-all placeholder:text-[#CBD5E1]/45 focus:border-[#3B82F6] focus:bg-[#475569]/30 focus:shadow-[0_0_0_3px_rgba(34,211,238,.12)] disabled:opacity-50"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="px-1 text-[10px] font-medium tracking-[.14em] text-white/60 uppercase">密码</span>
                  <span className="relative">
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={!ready || submitting}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                      minLength={8}
                      maxLength={128}
                      placeholder="至少输入 8 个字符"
                      className="h-12 w-full rounded-xl border border-[#CBD5E1]/20 bg-[#475569]/20 pr-11 pl-4 text-sm text-white outline-none transition-all placeholder:text-[#CBD5E1]/45 focus:border-[#3B82F6] focus:bg-[#475569]/30 focus:shadow-[0_0_0_3px_rgba(34,211,238,.12)] disabled:opacity-50"
                    />
                    <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center text-white/50 transition-colors hover:text-white" aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </span>
                </label>
                {creatingAccount && (
                  <label className="grid gap-1.5">
                    <span className="px-1 text-[10px] font-medium tracking-[.14em] text-white/60 uppercase">确认密码</span>
                    <input
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={!ready || submitting}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      placeholder="请再次输入密码"
                      className="h-12 rounded-xl border border-[#CBD5E1]/20 bg-[#475569]/20 px-4 text-sm text-white outline-none transition-all placeholder:text-[#CBD5E1]/45 focus:border-[#3B82F6] focus:bg-[#475569]/30 focus:shadow-[0_0_0_3px_rgba(34,211,238,.12)] disabled:opacity-50"
                    />
                  </label>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-5 text-xs">
                  <p className={success ? 'text-[#10B981]' : message ? 'text-[#EF4444]' : 'text-[#CBD5E1]/70'} role="status" aria-live="polite">
                    {message || (creatingAccount ? '账号信息将安全保存在当前设备。' : '当前工作台已启用本地登录保护。')}
                  </p>
                  {!setupRequired && !submitting && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <button type="button" onClick={switchAuthMode} className="text-[#22D3EE] transition-colors hover:text-white">
                        {registering ? '已有账号？返回登录' : '没有账号？立即注册'}
                      </button>
                      <a href="/admin/login" className="text-[#94A3B8] transition-colors hover:text-white">管理员入口</a>
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!ready || submitting}
                  className="group flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#3B82F6] px-5 text-sm font-medium text-white shadow-[0_8px_22px_rgba(59,130,246,.24)] transition-all hover:bg-[#7C3AED] hover:shadow-[0_10px_26px_rgba(124,58,237,.28)] disabled:cursor-wait disabled:opacity-60"
                >
                  {submitting ? '请稍候…' : setupRequired ? '创建并进入' : registering ? '提交注册' : '登录'}
                  <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
                </button>
              </div>
            </motion.form>
          </motion.div>
        </section>
      </div>
    </main>
  )
}
