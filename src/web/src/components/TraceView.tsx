import type { PipelineResult, TraceStep } from '../types'

interface TraceViewProps {
  steps: TraceStep[]
  result: PipelineResult | null
  running: boolean
}

const STATE_GLYPH: Record<TraceStep['state'], string> = {
  pending: '○',
  running: '◐',
  done: '●',
  skipped: '—',
}

export function TraceView({ steps, result, running }: TraceViewProps) {
  return (
    <section className="panel trace">
      <header className="panel-head">
        <h2>Pipeline trace</h2>
        <p className="muted">Each step mirrors a stage of processRawComplaint().</p>
      </header>

      {steps.length === 0 ? (
        <p className="empty">Send a complaint to watch it move through the pipeline.</p>
      ) : (
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.stage} className={`step step-${step.state}`}>
              <span className="step-glyph" aria-hidden="true">
                {STATE_GLYPH[step.state]}
              </span>
              <span className="step-body">
                <span className="step-label">{step.label}</span>
                {step.detail && <span className="step-detail">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {result && !running && (
        <div className={`outcome outcome-${result.outcome}`}>
          <strong>
            {result.outcome === 'matched' ? 'Deduplicated' : 'New report created'}
          </strong>
          <span>
            {result.similarity === null
              ? 'first report in the corpus'
              : `nearest similarity ${result.similarity.toFixed(3)}`}
            {' · report '}
            <code>{result.reportId.slice(0, 8)}</code>
          </span>
        </div>
      )}
    </section>
  )
}
