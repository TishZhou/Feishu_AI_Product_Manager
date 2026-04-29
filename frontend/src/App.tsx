import { useState } from 'react'
import { SetupView } from './components/SetupView'
import { ConsoleView } from './components/ConsoleView'

export default function App() {
  const [runId, setRunId] = useState<string | null>(null)

  return (
    <>
      {!runId ? (
        <SetupView onRunStarted={setRunId} />
      ) : (
        <ConsoleView runId={runId} onBack={() => setRunId(null)} />
      )}
    </>
  )
}
