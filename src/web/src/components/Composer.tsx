import { useState } from 'react'
import { SAMPLE_COMPLAINTS } from '../lib/seed'

interface ComposerProps {
  disabled: boolean
  threshold: number
  onThresholdChange: (value: number) => void
  onSubmit: (text: string) => void
}

export function Composer({ disabled, threshold, onThresholdChange, onSubmit }: ComposerProps) {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setText('')
  }

  return (
    <section className="panel composer">
      <header className="panel-head">
        <h2>Incoming complaint</h2>
        <p className="muted">Stands in for a webhook delivery to the ingest endpoint.</p>
      </header>

      <textarea
        className="composer-input"
        rows={5}
        value={text}
        disabled={disabled}
        placeholder="Paste an unstructured customer complaint…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
        }}
      />

      <div className="samples">
        {SAMPLE_COMPLAINTS.map((sample, index) => (
          <button
            key={sample}
            type="button"
            className="chip"
            disabled={disabled}
            title={sample}
            onClick={() => setText(sample)}
          >
            Sample {index + 1}
          </button>
        ))}
      </div>

      <div className="composer-actions">
        <label className="threshold">
          <span>
            SIMILARITY_THRESHOLD <strong>{threshold.toFixed(2)}</strong>
          </span>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={threshold}
            disabled={disabled}
            onChange={(event) => onThresholdChange(Number(event.target.value))}
          />
        </label>
        <button type="button" className="primary" onClick={submit} disabled={disabled || !text.trim()}>
          {disabled ? 'Processing…' : 'Send complaint'}
        </button>
      </div>
    </section>
  )
}
