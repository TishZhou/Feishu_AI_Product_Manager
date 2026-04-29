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
    <div className="min-h-screen bg-[#030712] flex items-center justify-center p-6 relative overflow-hidden bg-grid">
      {/* Background blobs */}
      <div className="blob-1 absolute top-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-[0.12] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #3370ff 0%, transparent 70%)' }} />
      <div className="blob-2 absolute bottom-[-20%] right-[-5%] w-[700px] h-[700px] rounded-full opacity-[0.09] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
      <div className="absolute top-[40%] right-[15%] w-[300px] h-[300px] rounded-full opacity-[0.07] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #00b42a 0%, transparent 70%)' }} />

      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-xl"
      >
        {/* Outer glow border */}
        <div className="absolute -inset-px rounded-3xl pointer-events-none"
          style={{ background: 'linear-gradient(135deg, rgba(51,112,255,0.25) 0%, rgba(255,255,255,0.04) 50%, rgba(124,58,237,0.15) 100%)' }} />

        <div className="relative glass-panel-deep rounded-3xl p-8 shadow-[0_32px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.06)]">
          {/* Header */}
          <div className="flex items-center gap-4 mb-9">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl blur-md opacity-60"
                style={{ background: 'radial-gradient(circle, rgba(51,112,255,0.8) 0%, transparent 70%)' }} />
              <div className="relative p-3.5 rounded-2xl border border-[#3370ff]/30"
                style={{ background: 'linear-gradient(135deg, rgba(51,112,255,0.2) 0%, rgba(51,112,255,0.08) 100%)' }}>
                <Zap className="w-6 h-6 text-[#3370ff]" strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight leading-none">DevFlow Engine</h1>
              <p className="text-slate-400 text-sm mt-1 font-light">AI 驱动的全自动开发流水线</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Task description */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3370ff] inline-block" />
                任务描述
              </label>
              <div className="relative">
                <textarea
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="描述你需要 AI 构建的功能或修复的问题..."
                  className="glass-input w-full h-32 rounded-2xl p-4 text-white placeholder-slate-600 resize-none mono text-sm leading-relaxed"
                  required
                />
                {taskDescription && (
                  <div className="absolute bottom-3 right-3 text-[10px] text-slate-600 font-mono">
                    {taskDescription.length} 字
                  </div>
                )}
              </div>
            </div>

            {/* Repo + Provider */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-widest">
                  <GitBranch className="w-3 h-3 text-slate-500" />
                  仓库路径
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  className="glass-input w-full rounded-xl px-4 py-3 text-white mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-widest">
                  <Cpu className="w-3 h-3 text-slate-500" />
                  推理提供商
                </label>
                <div className="relative">
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="glass-input w-full rounded-xl px-4 py-3 text-white text-sm appearance-none cursor-pointer"
                    style={{ backgroundImage: 'none' }}
                  >
                    <option value="openai" style={{ background: '#1e293b' }}>OpenAI</option>
                    <option value="volcano" style={{ background: '#1e293b' }}>火山引擎</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Model override */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                模型指定
                <span className="normal-case font-normal text-slate-600 tracking-normal">（可选）</span>
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="留空使用默认模型，如 gpt-4o"
                className="glass-input w-full rounded-xl px-4 py-3 text-white mono text-sm"
              />
            </div>

            {/* Divider */}
            <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />

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
          <p className="text-center text-[11px] text-slate-600 mt-5">
            7 个自动化阶段 · 人工审核节点 · 实时可观测
          </p>
        </div>
      </motion.div>
    </div>
  )
}
