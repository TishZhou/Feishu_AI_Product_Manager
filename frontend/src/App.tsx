import { useState } from 'react'
import { SetupView } from './components/SetupView'
import { ConsoleView } from './components/ConsoleView'

export default function App() {
  const [runId, setRunId] = useState<string | null>(null)

  return (
    <div className="relative">
      <div className="absolute top-0 left-0 p-4">Hello</div>
      {!runId ? (
        <SetupView onRunStarted={setRunId} />
      ) : (
        <ConsoleView runId={runId} onBack={() => setRunId(null)} />
      )}
    </div>
  )
}
