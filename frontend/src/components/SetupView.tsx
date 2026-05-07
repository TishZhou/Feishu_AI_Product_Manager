import { useState, useEffect, useRef } from 'react'
import { Play, Rocket, FolderOpen, AlertCircle, Sparkles, RefreshCw } from 'lucide-react'
import { useCreatePipeline, useCreateRun, useWorkspace } from '../hooks/useDevFlow'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'
import { DirectoryBrowser } from './DirectoryBrowser'
import { apiClient } from '../lib/api'

interface SetupViewProps {
  onRunStarted: (runId: string) => void
}

type Mode = 'vibe' | 'selfupgrade'

const AGENTS = [
  { key: 'pria',  label: 'P', name: 'Pria',  role: '产品经理 AI · 需求分析',     bg: 'linear-gradient(135deg,#FB7185,#E11D48)' },
  { key: 'aria',  label: 'A', name: 'Aria',  role: '软件架构师 AI · 架构设计',   bg: 'linear-gradient(135deg,#60A5FA,#2563EB)' },
  { key: 'specy', label: 'S', name: 'Specy', role: '系统设计师 AI · 详细规格',   bg: 'linear-gradient(135deg,#A78BFA,#7C3AED)' },
  { key: 'eden',  label: 'E', name: 'Eden',  role: '软件工程师 AI · 代码生成',   bg: 'linear-gradient(135deg,#34D399,#059669)' },
  { key: 'quill', label: 'Q', name: 'Quill', role: 'QA 工程师 AI · 测试生成',    bg: 'linear-gradient(135deg,#FBBF24,#D97706)' },
  { key: 'rex',   label: 'R', name: 'Rex',   role: '代码审查员 AI · 代码审查',   bg: 'linear-gradient(135deg,#F472B6,#BE185D)' },
  { key: 'devon', label: 'D', name: 'Devon', role: 'DevOps AI · 交付打包',       bg: 'linear-gradient(135deg,#818CF8,#4338CA)' },
]

const INSPIRATIONS = [
  { icon: '📬', label: '邮件 Agent',  text: '做一个能自动检测我邮箱新邮件的 agent workflow，按发件人和关键词过滤，触发后发送 Slack 通知' },
  { icon: '🔐', label: 'OAuth 接入',  text: '给现有 API 添加 OAuth 2.0 认证流程，包含登录、回调、token 刷新与登出' },
  { icon: '💬', label: '实时聊天',   text: '为 Web 应用添加实时聊天功能，支持多人房间、消息历史、未读提示' },
  { icon: '📊', label: '数据看板',   text: '构建一个数据看板页面，展示 KPI 卡片、趋势图、可筛选的数据表格' },
]

const BEAMS = [
  { left: '12%', color: 'rgba(96,165,250,0.55)', shadow: 'rgba(96,165,250,0.45)', dur: '6s', delay: '0s' },
  { left: '28%', color: 'rgba(167,139,250,0.55)', shadow: 'rgba(167,139,250,0.45)', dur: '7.5s', delay: '-1.8s' },
  { left: '48%', color: 'rgba(96,165,250,0.55)', shadow: 'rgba(96,165,250,0.45)', dur: '6.5s', delay: '-3s' },
  { left: '68%', color: 'rgba(124,58,237,0.50)', shadow: 'rgba(124,58,237,0.40)', dur: '8s', delay: '-1.2s' },
  { left: '82%', color: 'rgba(96,165,250,0.55)', shadow: 'rgba(96,165,250,0.45)', dur: '6s', delay: '-4s' },
  { left: '92%', color: 'rgba(167,139,250,0.50)', shadow: 'rgba(167,139,250,0.40)', dur: '7s', delay: '-2.5s' },
]

export function SetupView({ onRunStarted }: SetupViewProps) {
  const [mode, setMode] = useState<Mode>('vibe')
  const [taskDescription, setTaskDescription] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showBrowser, setShowBrowser] = useState(false)
  const [particles, setParticles] = useState<{ left: string; top: string; delay: string; dur: string; color: string; shadow: string }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [referenceFiles, setReferenceFiles] = useState<File[]>([])
  const [referenceContext, setReferenceContext] = useState('')
  const [referenceSources, setReferenceSources] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const [refDocError, setRefDocError] = useState<string | null>(null)

  const workspace = useWorkspace()
  const createPipeline = useCreatePipeline()
  const createRun = useCreateRun()

  const VIBE_DEFAULT = '/home/runner/vibe-projects'

  useEffect(() => {
    // Vibe Coding defaults to the dedicated vibe-projects directory
    if (!repoPath && mode === 'vibe') setRepoPath(VIBE_DEFAULT)
  }, [repoPath, mode])

  useEffect(() => {
    const ps = Array.from({ length: 20 }, (_, i) => ({
      left: Math.random() * 100 + '%',
      top: Math.random() * 100 + '%',
      delay: (Math.random() * 3) + 's',
      dur: (2 + Math.random() * 3) + 's',
      color: i % 3 === 0 ? '#A78BFA' : i % 3 === 1 ? '#93C5FD' : '#60A5FA',
      shadow: i % 3 === 0 ? 'rgba(167,139,250,0.6)' : 'rgba(147,197,253,0.6)',
    }))
    setParticles(ps)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [taskDescription, repoPath, provider, model, mode])

  const isSelfUpgrade = mode === 'selfupgrade'
  const effectiveRepoPath = isSelfUpgrade ? (workspace.data?.path ?? repoPath) : repoPath

  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement> | { target: { files: FileList | null } }) => {
    const files = Array.from(e.target.files || []) as File[]
    if (!files.length) return
    setIsExtracting(true)
    setRefDocError(null)
    try {
      const res = await apiClient.uploadReferenceDocuments(files)
      setReferenceFiles(files)
      setReferenceContext(res.reference_context)
      setReferenceSources(res.reference_sources)
    } catch {
      setRefDocError('文档解析失败，请检查文件格式后重试')
    } finally {
      setIsExtracting(false)
    }
  }

  const handleSubmit = async () => {
    if (!taskDescription) { textareaRef.current?.focus(); return }
    setSubmitError(null)
    try {
      const pipeline = await createPipeline.mutateAsync({
        name: `Run #${Math.floor(Math.random() * 1000)}`,
        description: taskDescription,
        task_type: 'feature',
        repo_path: effectiveRepoPath,
        provider,
        model: model || undefined,
        confirm_self_modification: isSelfUpgrade,
        reference_context: referenceContext || undefined,
        reference_sources: referenceSources || undefined,
      } as any)
      const run = await createRun.mutateAsync(pipeline.id)
      onRunStarted(run.id)
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status
        const detail = err.response?.data?.detail ?? ''
        const code = typeof detail === 'object' ? detail?.code : ''

        if (status === 409 && code === 'self_modification_consent_required') {
          setSubmitError('当前路径是 DevFlow 自身代码库，请切换到右边的「DevFlow 升级」模式来启动。')
        } else if (status === 400) {
          const msg = typeof detail === 'string' ? detail : (detail?.message ?? '')
          setSubmitError(msg.toLowerCase().includes('repo_path') || msg.toLowerCase().includes('does not exist')
            ? `路径不存在，请确认目录已建立：${effectiveRepoPath}`
            : msg || '请求参数有误，请检查输入。')
        } else {
          setSubmitError(`启动失败（${status ?? '未知错误'}），请查看控制台或稍后重试。`)
        }
      } else {
        setSubmitError('启动流水线失败，请稍后重试。')
      }
      console.error('Failed to start pipeline', err)
    }
  }

  const isLoading = createPipeline.isPending || createRun.isPending

  return (
    <div className="setup-root relative overflow-x-hidden">

      {/* ── Background layers ── */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Aurora blobs */}
        <div className="sv5-aurora-1 absolute rounded-full" style={{ width: 620, height: 620, background: 'radial-gradient(circle,rgba(96,165,250,0.32),transparent 70%)', top: -240, left: '28%', filter: 'blur(100px)' }} />
        <div className="sv5-aurora-2 absolute rounded-full" style={{ width: 480, height: 480, background: 'radial-gradient(circle,rgba(167,139,250,0.24),transparent 70%)', top: '38%', right: -120, filter: 'blur(100px)' }} />
        <div className="sv5-aurora-3 absolute rounded-full" style={{ width: 420, height: 420, background: 'radial-gradient(circle,rgba(191,219,254,0.32),transparent 70%)', bottom: -150, left: '6%', filter: 'blur(100px)' }} />
        <div className="sv5-aurora-4 absolute rounded-full" style={{ width: 320, height: 320, background: 'radial-gradient(circle,rgba(124,58,237,0.14),transparent 70%)', top: '55%', left: '38%', filter: 'blur(100px)' }} />

        {/* Grid */}
        <div className="sv5-grid absolute" style={{ inset: '-20%', backgroundImage: 'linear-gradient(rgba(59,130,246,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,0.06) 1px,transparent 1px)', backgroundSize: '56px 56px', WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 35%,#000 30%,transparent 75%)', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 35%,#000 30%,transparent 75%)' }} />

        {/* Orbit */}
        <div className="absolute" style={{ top: '26%', left: '50%', transform: 'translate(-50%,-50%)', width: 720, height: 720, pointerEvents: 'none' }}>
          <div className="sv5-orbit-1 absolute inset-0 rounded-full" style={{ border: '1px dashed rgba(59,130,246,0.14)' }}>
            <div className="absolute rounded-full" style={{ width: 10, height: 10, top: -5, left: '50%', transform: 'translateX(-50%)', background: 'radial-gradient(circle,white 30%,#3B82F6 100%)', boxShadow: '0 0 10px rgba(59,130,246,0.7),0 0 20px rgba(59,130,246,0.35)' }} />
          </div>
          <div className="sv5-orbit-2 absolute rounded-full" style={{ inset: 90, border: '1px dashed rgba(124,58,237,0.12)' }}>
            <div className="absolute rounded-full" style={{ width: 10, height: 10, top: -5, left: '50%', transform: 'translateX(-50%)', background: 'radial-gradient(circle,white 30%,#8B5CF6 100%)', boxShadow: '0 0 10px rgba(124,58,237,0.7),0 0 20px rgba(124,58,237,0.35)' }} />
          </div>
          <div className="sv5-orbit-3 absolute rounded-full" style={{ inset: 180, border: '1px solid rgba(59,130,246,0.07)' }}>
            <div className="absolute rounded-full" style={{ width: 7, height: 7, bottom: 180, left: '50%', transform: 'translateX(-50%)', background: 'radial-gradient(circle,white 30%,#3B82F6 100%)', boxShadow: '0 0 10px rgba(59,130,246,0.7)' }} />
          </div>
        </div>

        {/* Light beams */}
        <div className="absolute inset-0 overflow-hidden">
          {BEAMS.map((b, i) => (
            <div key={i} className="sv5-beam absolute" style={{ left: b.left, width: 1.5, height: 240, borderRadius: 999, filter: 'blur(0.5px)', background: `linear-gradient(180deg,transparent,${b.color},transparent)`, boxShadow: `0 0 14px ${b.shadow}`, animationDuration: b.dur, animationDelay: b.delay }} />
          ))}
        </div>

        {/* Particles */}
        {particles.map((p, i) => (
          <div key={i} className="sv5-particle absolute rounded-full" style={{ left: p.left, top: p.top, width: 3, height: 3, background: p.color, boxShadow: `0 0 6px ${p.shadow}`, animationDelay: p.delay, animationDuration: p.dur }} />
        ))}
      </div>

      {/* ── Top bar ── */}
      <header className="relative z-10 flex items-center justify-between px-7 py-4" style={{ borderBottom: '1px solid rgba(238,242,247,0.6)', background: 'rgba(252,253,254,0.55)', backdropFilter: 'saturate(180%) blur(14px)' }}>
        <div className="sv5-fade-up flex items-center gap-2.5" style={{ animationDelay: '.05s' }}>
          <div className="sv5-brand-shine relative rounded-xl flex items-center justify-center overflow-hidden" style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', boxShadow: '0 4px 14px rgba(59,130,246,0.30),inset 0 1px 0 rgba(255,255,255,0.20)' }}>
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: 'white', strokeWidth: 2.5, fill: 'none', position: 'relative', zIndex: 1 }}><path d="M3 12l4.5-4.5L12 12l4.5-4.5L21 12M3 17l4.5-4.5L12 17l4.5-4.5L21 17" /></svg>
          </div>
          <span style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>DevFlow</span>
          <span style={{ fontSize: 13.5, color: '#94A3B8', fontWeight: 400 }}>Engine</span>
        </div>
        <div className="sv5-fade-up flex items-center gap-3" style={{ animationDelay: '.15s' }}>
          {[
            { label: '历史运行', icon: <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: 'currentColor', strokeWidth: 1.7, fill: 'none' }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
            { label: '文档', icon: <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: 'currentColor', strokeWidth: 1.7, fill: 'none' }}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
          ].map(link => (
            <a key={link.label} href="#" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all" style={{ fontSize: 12.5, color: '#475569', textDecoration: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.7)'; (e.currentTarget as HTMLElement).style.color = '#0A1628' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.color = '#475569' }}>
              {link.icon}{link.label}
            </a>
          ))}
        </div>
      </header>

      {/* ── Main content ── */}
      <div className="relative z-10 max-w-3xl mx-auto px-6 py-16 pb-20">

        {/* Hero */}
        <div className="sv5-fade-up text-center mb-12" style={{ animationDelay: '.2s' }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-6 rounded-full" style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', border: '1px solid rgba(59,130,246,0.20)', fontSize: 11.5, fontWeight: 500, color: '#1D4ED8', letterSpacing: '0.04em', boxShadow: '0 2px 8px rgba(59,130,246,0.08)' }}>
            <span className="sv5-live-dot rounded-full" style={{ width: 6, height: 6, background: '#3B82F6', display: 'inline-block' }} />
            AI PIPELINE ENGINE · v1.6
          </div>
          <h1 style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 60, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.02, marginBottom: 20, color: '#0A1628' }}>
            告诉我们你想<br />
            <span className="sv5-gradient-text">构建什么</span>
          </h1>
          <p style={{ fontFamily: "'Instrument Serif',serif", fontStyle: 'italic', fontSize: 22, color: '#64748B', fontWeight: 400 }}>
            7 位 AI 协作专家，将与你共同完成开发的每一步
          </p>
        </div>

        {/* AI Team Strip */}
        <div className="sv5-fade-up mb-12" style={{ animationDelay: '.3s' }}>
          <p className="text-center mb-5" style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.16em', color: '#94A3B8' }}>YOUR AI TEAM</p>
          <div className="flex justify-center relative">
            {/* connecting beam */}
            <div className="absolute" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 380, height: 60, pointerEvents: 'none', zIndex: 0 }}>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1.5, background: 'linear-gradient(90deg,transparent 0%,rgba(96,165,250,0.4) 15%,rgba(167,139,250,0.4) 50%,rgba(96,165,250,0.4) 85%,transparent 100%)', transform: 'translateY(-50%)' }} />
              <div className="sv5-team-beam-dot" style={{ position: 'absolute', top: '50%', left: 0, width: 30, height: 1.5, background: 'linear-gradient(90deg,transparent,white,transparent)', boxShadow: '0 0 12px rgba(255,255,255,1),0 0 24px rgba(96,165,250,0.7),0 0 36px rgba(167,139,250,0.4)', transform: 'translateY(-50%)', borderRadius: 999 }} />
            </div>
            {AGENTS.map((agent, i) => (
              <div key={agent.key} className="relative group" style={{ zIndex: 1, marginLeft: i === 0 ? 0 : -10, animation: `sv5-avatar-pop .5s cubic-bezier(0.16,1,0.3,1) ${0.45 + i * 0.05}s backwards, sv5-avatar-float 5s ease-in-out ${-i * 0.7}s infinite`, transition: 'transform .25s cubic-bezier(0.16,1,0.3,1)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-12px) scale(1.12)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = ''}>
                <div style={{ width: 54, height: 54, borderRadius: '50%', background: agent.bg, display: 'grid', placeItems: 'center', color: 'white', fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 15, border: '3px solid white', boxShadow: '0 6px 16px rgba(15,23,42,0.10),0 2px 4px rgba(15,23,42,0.06)' }}>
                  {agent.label}
                </div>
                <div className="absolute opacity-0 group-hover:opacity-100 pointer-events-none transition-all" style={{ top: 68, left: '50%', transform: 'translateX(-50%)', background: '#0A1628', color: 'white', padding: '7px 12px', borderRadius: 8, fontSize: 11.5, whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(15,23,42,0.20)', zIndex: 20 }}>
                  <div style={{ fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10.5, marginTop: 1 }}>{agent.role}</div>
                  <div style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 8, height: 8, background: '#0A1628' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Card */}
        <div className="sv5-card relative" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 28, boxShadow: '0 40px 100px rgba(37,99,235,0.10),0 16px 36px rgba(15,23,42,0.06),inset 0 1px 0 rgba(255,255,255,0.9)', overflow: 'hidden' }}>

          {/* Breathing border */}
          <div className="absolute inset-0 pointer-events-none rounded-[28px]" style={{ padding: 1.5, background: 'linear-gradient(135deg,rgba(96,165,250,0.5),transparent 30%,transparent 70%,rgba(167,139,250,0.5))', WebkitMask: 'linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude', animation: 'sv5-border-pulse 4s ease-in-out infinite' }} />

          {/* ─ Task Section ─ */}
          <div style={{ padding: '30px 34px 24px', borderBottom: '1px solid #EEF2F7' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#EFF6FF,rgba(167,139,250,0.10))', color: '#2563EB' }}>
                  <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 15, fontWeight: 600, color: '#0A1628', letterSpacing: '-0.01em' }}>描述任务</span>
              </div>
              <span style={{ fontSize: 11.5, color: '#94A3B8' }}>越具体越好 · 中英文皆可</span>
            </div>

            <textarea
              ref={textareaRef}
              value={taskDescription}
              onChange={e => setTaskDescription(e.target.value)}
              placeholder={isSelfUpgrade ? '描述需要为 DevFlow 新增或改进的功能，例如：增加一个可以上传参考文档的功能...' : '例如：做一个能自动检测我邮箱新邮件的 agent workflow，按发件人和关键词过滤，触发后发送 Slack 通知...'}
              style={{ width: '100%', minHeight: 120, padding: '18px 20px', background: '#F7F9FC', border: '1.5px solid #E2E8F0', borderRadius: 14, fontFamily: 'inherit', fontSize: 15, color: '#0A1628', lineHeight: 1.6, resize: 'vertical', outline: 'none', transition: 'all .2s' }}
              onFocus={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#60A5FA'; e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.10),0 4px 16px rgba(59,130,246,0.08)' }}
              onBlur={e => { e.currentTarget.style.background = '#F7F9FC'; e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
            />

            {/* Inspiration chips */}
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              <span style={{ fontSize: 11.5, color: '#94A3B8', marginRight: 4 }}>灵感:</span>
              {INSPIRATIONS.map(ins => (
                <button key={ins.label} type="button" onClick={() => { setTaskDescription(ins.text); textareaRef.current?.focus() }}
                  className="inline-flex items-center gap-1.5 transition-all"
                  style={{ padding: '5px 11px', background: 'white', border: '1px solid #E2E8F0', borderRadius: 999, fontSize: 11.5, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#93C5FD'; (e.currentTarget as HTMLElement).style.color = '#1D4ED8'; (e.currentTarget as HTMLElement).style.background = '#EFF6FF'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; (e.currentTarget as HTMLElement).style.color = '#334155'; (e.currentTarget as HTMLElement).style.background = 'white'; (e.currentTarget as HTMLElement).style.transform = '' }}>
                  <span>{ins.icon}</span>{ins.label}
                </button>
              ))}
            </div>
          </div>

          {/* ─ Knowledge Base Section ─ */}
          <div style={{ padding: '20px 34px', borderBottom: '1px solid #EEF2F7' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: 'linear-gradient(135deg,rgba(251,191,36,0.14),rgba(217,119,6,0.10))', color: '#D97706' }}>
                  <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 15, fontWeight: 600, color: '#0A1628', letterSpacing: '-0.01em' }}>参考文档</span>
                <span style={{ fontSize: 11, color: '#94A3B8', background: '#F1F5F9', padding: '1px 7px', borderRadius: 999 }}>可选</span>
              </div>
              <span style={{ fontSize: 11.5, color: '#94A3B8' }}>PDF · DOCX · TXT · MD</span>
            </div>

            {referenceContext ? (
              <div style={{ padding: '12px 14px', background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.18)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>✅</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#065F46' }}>
                    已导入 {referenceFiles.length} 个文档
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                    共 {(referenceContext.length / 1000).toFixed(1)}k 字符已提取，将在需求分析阶段作为 RAG 参考
                  </div>
                </div>
                <button
                  onClick={() => { setReferenceFiles([]); setReferenceContext(''); setReferenceSources('') }}
                  style={{ padding: '4px 10px', background: 'transparent', border: '1px solid rgba(5,150,105,0.25)', borderRadius: 6, fontSize: 12, color: '#059669', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  清除
                </button>
              </div>
            ) : (
              <label style={{ display: 'block', cursor: isExtracting ? 'not-allowed' : 'pointer' }}>
                <input
                  type="file" multiple accept=".pdf,.txt,.md,.docx"
                  style={{ display: 'none' }}
                  onChange={handleReferenceUpload}
                  disabled={isExtracting}
                />
                <div
                  style={{ padding: '16px', background: '#F7F9FC', border: '1.5px dashed #CBD5E1', borderRadius: 10, textAlign: 'center', transition: 'all .2s' }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#93C5FD'; e.currentTarget.style.background = '#EFF6FF' }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.background = '#F7F9FC' }}
                  onDrop={e => {
                    e.preventDefault()
                    e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.background = '#F7F9FC'
                    handleReferenceUpload({ target: { files: e.dataTransfer.files } })
                  }}
                >
                  {isExtracting ? (
                    <div style={{ fontSize: 13, color: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      正在提取文档内容…
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 20, marginBottom: 5 }}>📎</div>
                      <div style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>点击或拖拽上传参考文档</div>
                      <div style={{ fontSize: 11.5, color: '#9CA3AF', marginTop: 3 }}>代码规范、业务说明书、API 文档等，AI 会在需求分析时参考</div>
                    </>
                  )}
                </div>
              </label>
            )}
            {refDocError && <p style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>{refDocError}</p>}
          </div>

          {/* ─ Config Section ─ */}
          <div style={{ padding: '26px 34px', borderBottom: '1px solid #EEF2F7' }}>
            <div className="flex items-center gap-2.5 mb-5">
              <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: 'linear-gradient(135deg,rgba(167,139,250,0.14),rgba(124,58,237,0.10))', color: '#7C3AED' }}>
                <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </div>
              <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 15, fontWeight: 600, color: '#0A1628', letterSpacing: '-0.01em' }}>配置</span>
            </div>

            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl mb-5" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
              {([
                { key: 'vibe', icon: <Sparkles className="w-3.5 h-3.5 shrink-0" />, label: 'Vibe Coding', sub: '为任意仓库生成代码', active: mode === 'vibe', color: '#2563EB', bg: 'white', border: '#93C5FD', shadow: 'rgba(59,130,246,0.08)' },
                { key: 'selfupgrade', icon: <RefreshCw className="w-3.5 h-3.5 shrink-0" />, label: 'DevFlow 升级', sub: '自动升级本平台代码', active: mode === 'selfupgrade', color: '#7C3AED', bg: 'white', border: '#C4B5FD', shadow: 'rgba(124,58,237,0.08)' },
              ] as any[]).map(m => (
                <button key={m.key} type="button" onClick={() => { setMode(m.key as Mode); setSubmitError(null) }}
                  className="flex items-center gap-2.5 rounded-lg px-4 py-3 text-left transition-all duration-200"
                  style={m.active ? { background: m.bg, border: `1.5px solid ${m.border}`, boxShadow: `0 2px 8px ${m.shadow}`, color: m.color } : { background: 'transparent', border: '1.5px solid transparent', color: '#94A3B8' }}>
                  <span style={{ color: m.active ? m.color : '#94A3B8' }}>{m.icon}</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1, color: m.active ? '#0A1628' : '#94A3B8' }}>{m.label}</p>
                    <p style={{ fontSize: 10.5, marginTop: 3, color: m.active ? '#475569' : '#CBD5E1' }}>{m.sub}</p>
                  </div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Repo Path — only in vibe mode */}
              <AnimatePresence>
                {!isSelfUpgrade ? (
                  <motion.div key="repo-vibe" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-1.5 overflow-hidden">
                    <label className="flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 500, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="6" y1="9" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><path d="M18 9c0 6-6 6-6 12"/></svg>
                      REPO 路径
                    </label>
                    <div className="flex gap-2">
                      <input type="text" value={repoPath} onChange={e => { setRepoPath(e.target.value); setSubmitError(null) }}
                        placeholder={workspace.isLoading ? '检测中...' : '/path/to/repo'}
                        style={{ flex: 1, minWidth: 0, padding: '11px 14px', background: '#F7F9FC', border: '1.5px solid #E2E8F0', borderRadius: 10, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: '#0A1628', outline: 'none', transition: 'all .2s' }}
                        onFocus={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#60A5FA'; e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.08)' }}
                        onBlur={e => { e.currentTarget.style.background = '#F7F9FC'; e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                      />
                      <button type="button" onClick={() => setShowBrowser(true)} title="浏览目录"
                        className="flex items-center justify-center rounded-lg transition-all shrink-0"
                        style={{ width: 40, background: '#F7F9FC', border: '1.5px solid #E2E8F0' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#93C5FD'; (e.currentTarget as HTMLElement).style.background = '#EFF6FF' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; (e.currentTarget as HTMLElement).style.background = '#F7F9FC' }}>
                        <FolderOpen className="w-3.5 h-3.5" style={{ color: '#60A5FA' }} />
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: '#94A3B8' }}>代码目录的绝对路径</p>
                  </motion.div>
                ) : (
                  <motion.div key="repo-upgrade" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-1.5 overflow-hidden">
                    <label style={{ fontSize: 11.5, fontWeight: 500, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>目标路径</label>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: 'rgba(139,92,246,0.06)', border: '1.5px solid rgba(139,92,246,0.2)' }}>
                      <RefreshCw className="w-3.5 h-3.5 shrink-0" style={{ color: '#8B5CF6' }} />
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#7C3AED' }}>{workspace.data?.path ?? '检测中…'}</span>
                    </div>
                    <p style={{ fontSize: 11, color: '#94A3B8' }}>自动指向 DevFlow 源码目录</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Provider */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 500, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  PROVIDER
                </label>
                <div className="flex gap-1.5">
                  {[{ value: 'openai', label: 'OpenAI' }, { value: 'volcano', label: 'Volcano' }].map(p => (
                    <button key={p.value} type="button" onClick={() => setProvider(p.value)}
                      className="flex-1 flex items-center justify-center gap-1.5 transition-all"
                      style={{ padding: '10px', background: provider === p.value ? '#EFF6FF' : 'white', border: `1.5px solid ${provider === p.value ? '#60A5FA' : '#E2E8F0'}`, borderRadius: 9, fontSize: 12, color: provider === p.value ? '#1D4ED8' : '#475569', cursor: 'pointer', fontFamily: 'inherit', fontWeight: provider === p.value ? 500 : 400 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: provider === p.value ? '#3B82F6' : '#CBD5E1', display: 'inline-block' }} />
                      {p.label}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: '#94A3B8' }}>推理服务提供方</p>
              </div>

              {/* Model — full width */}
              <div className="col-span-2 flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 500, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  模型 <span style={{ fontSize: 10.5, fontWeight: 400, color: '#94A3B8', textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>{provider === 'openai' ? '' : '(可选)'}</span>
                </label>

                {provider === 'openai' ? (
                  <>
                    <div className="flex gap-1.5">
                      {[
                        { value: 'gpt-4o',        label: 'GPT-4o',        hint: '强能力 · 标准价' },
                        { value: 'gpt-4o-mini',   label: 'GPT-4o mini',   hint: '便宜 · 16k 输出' },
                        { value: 'gpt-5.4-mini',  label: 'GPT-5.4 mini',  hint: '推理型 · 长输出' },
                      ].map(m => (
                        <button key={m.value} type="button" onClick={() => setModel(m.value)}
                          className="flex-1 flex flex-col items-center gap-0.5 transition-all"
                          style={{ padding: '10px 8px', background: model === m.value ? '#EFF6FF' : 'white', border: `1.5px solid ${model === m.value ? '#60A5FA' : '#E2E8F0'}`, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                          <span style={{ fontSize: 12, fontWeight: model === m.value ? 600 : 500, color: model === m.value ? '#1D4ED8' : '#0A1628' }}>{m.label}</span>
                          <span style={{ fontSize: 10, color: model === m.value ? '#3B82F6' : '#94A3B8' }}>{m.hint}</span>
                        </button>
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: '#94A3B8' }}>已选：<span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#475569' }}>{model || '尚未选择，留空将使用默认'}</span></p>
                  </>
                ) : (
                  <>
                    <input type="text" value={model} onChange={e => setModel(e.target.value)}
                      placeholder="留空使用默认模型，例如 doubao-pro"
                      style={{ width: '100%', padding: '11px 14px', background: '#F7F9FC', border: '1.5px solid #E2E8F0', borderRadius: 10, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: '#0A1628', outline: 'none', transition: 'all .2s' }}
                      onFocus={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#60A5FA'; e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.08)' }}
                      onBlur={e => { e.currentTarget.style.background = '#F7F9FC'; e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                    <p style={{ fontSize: 11, color: '#94A3B8' }}>指定具体模型名称，否则使用 Provider 的默认配置</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ─ Launch Section ─ */}
          <div style={{ padding: '22px 34px 26px', background: 'linear-gradient(180deg,transparent,rgba(247,249,252,0.6))' }}>
            {/* Error */}
            <AnimatePresence>
              {submitError && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="flex items-start gap-2.5 rounded-xl px-4 py-3 mb-4"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <p style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>{submitError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-4">
              <div className="flex-1 flex flex-wrap items-center gap-4" style={{ fontSize: 12, color: '#64748B' }}>
                {[
                  { icon: <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, text: <>预计 <strong style={{ color: '#1E293B' }}>5–8 分钟</strong></> },
                  { icon: <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><polyline points="20 6 9 17 4 12"/></svg>, text: <><strong style={{ color: '#1E293B' }}>2 个</strong>人工检查点</> },
                  { icon: <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>, text: '实时可观测' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">{item.icon}<span>{item.text}</span></div>
                ))}
              </div>

              <button type="button" onClick={handleSubmit} disabled={isLoading || !taskDescription}
                className="inline-flex items-center gap-2.5 relative overflow-hidden transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ padding: '14px 28px', background: isSelfUpgrade ? 'linear-gradient(135deg,#7C3AED,#4338CA)' : 'linear-gradient(135deg,#2563EB,#7C3AED)', color: 'white', border: 'none', borderRadius: 12, fontFamily: "'Inter Tight',sans-serif", fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em', cursor: isLoading || !taskDescription ? 'not-allowed' : 'pointer', boxShadow: '0 8px 22px rgba(59,130,246,0.35),0 4px 10px rgba(124,58,237,0.20),inset 0 1px 0 rgba(255,255,255,0.20)' }}
                onMouseEnter={e => { if (!isLoading && taskDescription) { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 14px 32px rgba(59,130,246,0.45),0 6px 16px rgba(124,58,237,0.30),inset 0 1px 0 rgba(255,255,255,0.25)' } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 22px rgba(59,130,246,0.35),0 4px 10px rgba(124,58,237,0.20),inset 0 1px 0 rgba(255,255,255,0.20)' }}>
                {/* shine sweep */}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(45deg,transparent 30%,rgba(255,255,255,0.25) 50%,transparent 70%)', animation: 'sv5-btn-shine 4s ease-in-out infinite' }} />
                {isLoading
                  ? <><Rocket className="w-4 h-4 relative z-10 animate-bounce" /><span className="relative z-10">启动中...</span></>
                  : <><Play className="w-4 h-4 relative z-10" strokeWidth={2.2} /><span className="relative z-10">{isSelfUpgrade ? '启动 DevFlow 升级' : '启动流水线'}</span><span className="relative z-10 ml-1 px-1.5 py-0.5 rounded text-[10.5px] font-mono" style={{ background: 'rgba(255,255,255,0.20)' }}>⌘ ↵</span></>
                }
              </button>
            </div>
          </div>
        </div>

        {/* Bottom strip */}
        <div className="sv5-fade-up flex justify-center gap-7 mt-9" style={{ animationDelay: '.6s' }}>
          {[
            { icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: '#3B82F6', strokeWidth: 1.8, fill: 'none' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, label: '端到端加密' },
            { icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: '#3B82F6', strokeWidth: 1.8, fill: 'none' }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, label: '支持中断与恢复' },
            { icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: '#3B82F6', strokeWidth: 1.8, fill: 'none' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, label: '一键导出代码 + 文档' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-2" style={{ fontSize: 12, color: '#64748B' }}>
              {item.icon}<span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Directory browser modal */}
      <AnimatePresence>
        {showBrowser && (
          <DirectoryBrowser
            initialPath={repoPath || workspace.data?.path}
            onSelect={path => { setRepoPath(path); setSubmitError(null) }}
            onClose={() => setShowBrowser(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
