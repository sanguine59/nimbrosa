import { useEffect, useRef, useState } from 'react'
import { Composer } from './components/Composer'
import { RawFeed } from './components/RawFeed'
import { ReportList } from './components/ReportList'
import { Stats } from './components/Stats'
import { TraceView } from './components/TraceView'
import { API_BASE_URL, fetchLiveState } from './lib/api'
import { runPipeline, type PipelineState } from './lib/pipeline'
import { buildSeedState, DEFAULT_THRESHOLD } from './lib/seed'
import type { PipelineResult, TraceStep } from './types'
import './App.css'

type Source = 'loading' | 'live' | 'simulated'

const EMPTY_STATE: PipelineState = { complaints: [], reports: [] }

function App() {
  const [state, setState] = useState<PipelineState>(EMPTY_STATE)
  const [source, setSource] = useState<Source>('loading')
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [running, setRunning] = useState(false)
  const [freshReportId, setFreshReportId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  // StrictMode double-mounts in dev; seeding twice would duplicate the corpus.
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true

    let cancelled = false
    const bootstrap = async () => {
      try {
        const live = await fetchLiveState()
        if (cancelled) return
        // An empty database is less useful to look at than the seed corpus.
        if (live.complaints.length > 0 || live.reports.length > 0) {
          setState(live)
          setSource('live')
          return
        }
      } catch {
        // API is down or CORS-blocked — simulation mode is the fallback.
      }

      const seeded = await buildSeedState()
      if (cancelled) return
      setState(seeded)
      setSource('simulated')
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (text: string) => {
    setRunning(true)
    setResult(null)
    setSteps([])
    setFreshReportId(null)

    const run = await runPipeline(text, state, {
      similarityThreshold: threshold,
      onStep: setSteps,
    })

    setState(run.state)
    setResult(run.result)
    setSteps(run.steps)
    setFreshReportId(run.result.reportId)
    setRunning(false)
  }

  const handleReset = async () => {
    setRunning(true)
    setSteps([])
    setResult(null)
    setSelectedReportId(null)
    setFreshReportId(null)
    const seeded = await buildSeedState()
    setState(seeded)
    setSource('simulated')
    setRunning(false)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Nimbrosa</h1>
          <p className="muted">
            Complaint deduplication pipeline — embed, search, then match or structure.
          </p>
        </div>
        <div className="topbar-right">
          <span className={`badge badge-${source}`}>
            {source === 'live'
              ? `live · ${API_BASE_URL}`
              : source === 'loading'
                ? 'connecting…'
                : 'simulation'}
          </span>
          <button type="button" className="chip" onClick={handleReset} disabled={running}>
            Reset corpus
          </button>
        </div>
      </header>

      {source === 'simulated' && (
        <p className="notice">
          Running against a local stand-in: hashed bag-of-words vectors and a rule-based
          structurer, no API key or database required. Start the server with{' '}
          <code>npm run serve</code> and a reachable database, then reload to hydrate from
          real rows.
        </p>
      )}

      <Stats complaintCount={state.complaints.length} reportCount={state.reports.length} />

      <div className="grid">
        <div className="col">
          <Composer
            disabled={running || source === 'loading'}
            threshold={threshold}
            onThresholdChange={setThreshold}
            onSubmit={handleSubmit}
          />
          <TraceView steps={steps} result={result} running={running} />
        </div>
        <ReportList
          reports={state.reports}
          highlightId={freshReportId}
          selectedId={selectedReportId}
          onSelect={setSelectedReportId}
        />
      </div>

      <RawFeed
        complaints={state.complaints}
        filterReportId={selectedReportId}
        onClearFilter={() => setSelectedReportId(null)}
      />
    </div>
  )
}

export default App
