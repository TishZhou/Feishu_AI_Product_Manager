import { useState } from 'react'
import { Play, Rocket, Zap, GitBranch, Cpu } from 'lucide-react'
import { useCreatePipeline, useCreateRun } from '../hooks/useDevFlow'
import { motion } from 'framer-motion'

interface SetupViewProps {
  onRunStarted: (runId: string) => void
}

export function SetupView({ onRunStarted }: SetupViewProps) {
  const [taskDescription, setTaskDescription] = useState('')
  const [repoPath, setRepoPath] = useState('./')
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')

  const createPipeline = useCreatePipeline()
  const createRun = useCreateRun()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskDescription) return

    try {
      const pipeline = await createPipeline.mutateAsync({
        name: `运行 #${Math.floor(Math.random() * 1000)}`,
        description: taskDescription,
        task_type: 'feature',
        repo_path: repoPath,
        provider,
        model: model || undefined,
      })

      const run = await createRun.mutateAsync(pipeline.id)
      onRunStarted(run.id)
    } catch (err) {
      console.error('启动流水线失败', err)
    }
  }

  const isLoading = createPipeline.isPending || createRun.isPending

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{
        backgroundImage: 'url(/bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Dark overlay for readability */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'rgba(5, 10, 25, 0.45)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-xl z-10"
      >
        {/* Subtle border glow ring */}
        <div
          className="absolute -inset-px rounded-3xl pointer-events-none"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 40%, rgba(51,112,255,0.2) 100%)',
          }}
        />

        {/* The frosted glass card — backdrop-filter blurs the PHOTO behind it */}
        <div
          className="relative rounded-3xl p-8 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
          style={{
            backdropFilter: 'blur(28px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
            background: 'rgba(8, 14, 32, 0.52)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-4 mb-9">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-2xl blur-md opacity-70"
                style={{
                  background:
                    'radial-gradient(circle, rgba(51,112,255,0.9) 0%, transparent 70%)',
                }}
              />
              <div
                className="relative p-3.5 rounded-2xl"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(51,112,255,0.25) 0%, rgba(51,112,255,0.1) 100%)',
                  border: '1px solid rgba(51,112,255,0.35)',
                }}
              >
                <Zap className="w-6 h-6 text-[#3370ff]" strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight leading-none">
                DevFlow Engine
              </h1>
              <p className="text-slate-300 text-sm mt-1 font-light">
                AI 驱动的全自动开发流水线
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Task description */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3370ff] inline-block" />
                任务描述
              </label>
              <div className="relative">
                <textarea
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="描述你需要 AI 构建的功能或修复的问题..."
                  className="w-full h-32 rounded-2xl p-4 text-white placeholder-slate-500 resize-none mono text-sm leading-relaxed transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    backdropFilter: 'blur(8px)',
                    outline: 'none',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(51,112,255,0.6)'
                    e.currentTarget.style.boxShadow =
                      '0 0 0 3px rgba(51,112,255,0.15)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor =
                      'rgba(255,255,255,0.12)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                  required
                />
                {taskDescription && (
                  <div className="absolute bottom-3 right-3 text-[10px] text-slate-500 font-mono">
                    {taskDescription.length} 字
                  </div>
                )}
              </div>
            </div>

            {/* Repo + Provider */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 uppercase tracking-widest">
                  <GitBranch className="w-3 h-3 text-slate-400" />
                  仓库路径
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-white mono text-sm transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    outline: 'none',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(51,112,255,0.5)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor =
                      'rgba(255,255,255,0.12)'
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 uppercase tracking-widest">
                  <Cpu className="w-3 h-3 text-slate-400" />
                  推理提供商
                </label>
                <div className="relative">
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full rounded-xl px-4 py-3 text-white text-sm appearance-none cursor-pointer transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      outline: 'none',
                      backgroundImage: 'none',
                    }}
                  >
                    <option value="openai" style={{ background: '#1e293b' }}>
                      OpenAI
                    </option>
                    <option value="volcano" style={{ background: '#1e293b' }}>
                      火山引擎
                    </option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg
                      className="w-4 h-4 text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Model override */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-widest">
                模型指定
                <span className="normal-case font-normal text-slate-500 tracking-normal">
                  （可选）
                </span>
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="留空使用默认模型，如 gpt-4o"
                className="w-full rounded-xl px-4 py-3 text-white mono text-sm transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  outline: 'none',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(51,112,255,0.5)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                }}
              />
            </div>

            {/* Divider */}
            <div
              className="h-px w-full"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)',
              }}
            />

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !taskDescription}
              className="btn-shimmer w-full py-4 text-white rounded-2xl font-semibold flex items-center justify-center gap-2.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            >
              {isLoading ? (
                <>
                  <Rocket className="w-5 h-5 animate-bounce" />
                  <span>正在启动流水线...</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" strokeWidth={2.5} />
                  <span>启动流水线</span>
                </>
              )}
            </button>
          </form>

          {/* Footer hint */}
          <p className="text-center text-[11px] text-slate-500 mt-5">
            7 个自动化阶段 · 人工审核节点 · 实时可观测
          </p>
        </div>
      </motion.div>
    </div>
  )
}
