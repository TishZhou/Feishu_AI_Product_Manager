import { useState } from 'react'
import { Play, Rocket, Zap, GitBranch, Cpu, AlertCircle, Paperclip, FileText, X } from 'lucide-react'
import { useCreatePipeline, useCreateRun, useExtractReferenceDocuments, useWorkspace } from '../hooks/useDevFlow'
import { motion } from 'framer-motion'
import axios from 'axios'
import { DEFAULT_REPO_PATH } from '../lib/api'

interface SetupViewProps {
  onRunStarted: (runId: string) => void
}

export function SetupView({ onRunStarted }: SetupViewProps) {
  const [taskDescription, setTaskDescription] = useState('')
  const [repoPath, setRepoPath] = useState(DEFAULT_REPO_PATH)
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [referenceFiles, setReferenceFiles] = useState<File[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)

  const workspace = useWorkspace()
  const createPipeline = useCreatePipeline()
  const createRun = useCreateRun()
  const extractReferenceDocuments = useExtractReferenceDocuments()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskDescription) return
    setSubmitError(null)

    try {
      const referenceContext = referenceFiles.length
        ? await extractReferenceDocuments.mutateAsync(referenceFiles)
        : { reference_context: '', reference_sources: '' }

      const pipeline = await createPipeline.mutateAsync({
        name: `运行 #${Math.floor(Math.random() * 1000)}`,
        description: taskDescription,
        task_type: 'feature',
        repo_path: repoPath,
        reference_context: referenceContext.reference_context,
        reference_sources: referenceContext.reference_sources,
        provider,
        model: model || undefined,
      })

      const run = await createRun.mutateAsync(pipeline.id)
      onRunStarted(run.id)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        const detail = err.response.data?.detail ?? ''
        if (detail.toLowerCase().includes('repo_path') || detail.toLowerCase().includes('does not exist')) {
          setSubmitError(`路径不存在，请检查服务器上是否有该目录：${repoPath}`)
        } else {
          setSubmitError(detail || '请求参数有误，请检查后重试')
        }
      } else {
        setSubmitError('启动流水线失败，请稍后重试')
      }
      console.error('启动流水线失败', err)
    }
  }

  const isLoading = extractReferenceDocuments.isPending || createPipeline.isPending || createRun.isPending
  const supportedDocumentTypes = '.pdf,.docx,.doc,.txt,.md'

  const inputStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    outline: 'none',
  }
  const focusStyle = { borderColor: 'rgba(51,112,255,0.5)' }
  const blurStyle = { borderColor: 'rgba(255,255,255,0.12)' }

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
        className="relative w-full max-w-2xl z-10"
      >
        {/* Subtle border glow ring */}
        <div
          className="absolute -inset-px rounded-3xl pointer-events-none"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 40%, rgba(51,112,255,0.2) 100%)',
          }}
        />

        {/* Frosted glass card */}
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

            {/* Reference documents */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 uppercase tracking-widest">
                <Paperclip className="w-3 h-3 text-slate-400" />
                参考文档
                <span className="normal-case font-normal text-slate-500 tracking-normal">（可选）</span>
              </label>
              <label
                className="block rounded-2xl px-4 py-4 cursor-pointer transition-all"
                style={{
                  ...inputStyle,
                  borderStyle: 'dashed',
                }}
              >
                <input
                  type="file"
                  multiple
                  accept={supportedDocumentTypes}
                  className="hidden"
                  onChange={(e) => {
                    setReferenceFiles(Array.from(e.target.files ?? []))
                    setSubmitError(null)
                  }}
                />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="p-2 rounded-xl shrink-0"
                      style={{
                        background: 'rgba(51,112,255,0.12)',
                        border: '1px solid rgba(51,112,255,0.2)',
                      }}
                    >
                      <FileText className="w-4 h-4 text-[#3370ff]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200">
                        上传 PRD、会议纪要、调研材料或相关说明
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        支持 PDF / DOCX / DOC / TXT / MD，需求分析 Agent 会作为 RAG 参考上下文读取
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-blue-300 shrink-0">
                    选择文件
                  </span>
                </div>
              </label>

              {referenceFiles.length > 0 && (
                <div className="space-y-2">
                  {referenceFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.lastModified}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                      style={{
                        background: 'rgba(15,23,42,0.55)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-slate-200 truncate">{file.name}</p>
                        <p className="text-[10px] text-slate-500">
                          {(file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReferenceFiles(files => files.filter(item => item !== file))}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors shrink-0"
                        aria-label={`移除 ${file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                  style={inputStyle}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(51,112,255,0.6)'
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(51,112,255,0.15)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
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
                  本地仓库路径
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => { setRepoPath(e.target.value); setSubmitError(null) }}
                  placeholder={workspace.isLoading ? '正在获取...' : '/path/to/repo'}
                  className="w-full rounded-xl px-4 py-3 text-white mono text-sm transition-all"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = focusStyle.borderColor }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = blurStyle.borderColor }}
                />
                {workspace.isError ? (
                  <p className="text-[10px] text-amber-500 leading-snug px-1">
                    无法获取默认路径，请手动填写服务器上的绝对路径
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500 leading-snug px-1">
                    服务器上的代码目录绝对路径
                  </p>
                )}
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
                    style={{ ...inputStyle, backgroundImage: 'none' }}
                  >
                    <option value="openai" style={{ background: '#1e293b' }}>OpenAI</option>
                    <option value="volcano" style={{ background: '#1e293b' }}>火山引擎</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Model override */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-widest">
                模型指定
                <span className="normal-case font-normal text-slate-500 tracking-normal">（可选）</span>
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="留空使用后端默认模型"
                className="w-full rounded-xl px-4 py-3 text-white mono text-sm transition-all"
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = focusStyle.borderColor }}
                onBlur={(e) => { e.currentTarget.style.borderColor = blurStyle.borderColor }}
              />
            </div>

            {/* Error banner */}
            {submitError && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-300 leading-snug">{submitError}</p>
              </motion.div>
            )}

            {/* Divider */}
            <div
              className="h-px w-full"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)' }}
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
                  <span>{extractReferenceDocuments.isPending ? '正在解析参考文档...' : '正在启动流水线...'}</span>
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
