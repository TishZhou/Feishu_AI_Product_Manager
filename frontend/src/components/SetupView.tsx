import { useState } from 'react'
import { Play, Rocket, Settings2 } from 'lucide-react'
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
        name: `Run #${Math.floor(Math.random() * 1000)}`,
        description: taskDescription,
        task_type: 'feature',
        repo_path: repoPath,
        provider,
        model: model || undefined,
      })

      const run = await createRun.mutateAsync(pipeline.id)
      onRunStarted(run.id)
    } catch (err) {
      console.error('Failed to start run', err)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full bg-white/5 backdrop-blur-md border border-white/10 p-8 rounded-2xl shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-[#3370ff]/10 rounded-xl border border-[#3370ff]/20">
            <Settings2 className="w-6 h-6 text-[#3370ff]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">DevFlow Engine</h1>
            <p className="text-slate-400 text-sm">Mission Control</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Task Description</label>
            <textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="What should the agent build?"
              className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder-slate-600 focus:outline-none focus:border-[#3370ff] focus:ring-1 focus:ring-[#3370ff] transition-all resize-none font-mono text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Repository Path</label>
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-[#3370ff] transition-all font-mono text-sm"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-[#3370ff] transition-all text-sm appearance-none"
              >
                <option value="openai">OpenAI</option>
                <option value="volcano">Volcano</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Model Override (Optional)</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gpt-4-turbo"
              className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-[#3370ff] transition-all font-mono text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={createPipeline.isPending || createRun.isPending || !taskDescription}
            className="w-full py-4 bg-[#3370ff] hover:bg-[#2b5ecc] text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createPipeline.isPending || createRun.isPending ? (
              <span className="flex items-center gap-2">
                <Rocket className="w-5 h-5 animate-bounce" /> Launching Pipeline...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Play className="w-5 h-5" /> Start Pipeline
              </span>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
