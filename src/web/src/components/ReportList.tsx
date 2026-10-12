import type { ReportRecord } from '../lib/pipeline'

interface ReportListProps {
  reports: ReportRecord[]
  highlightId: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function ReportList({ reports, highlightId, selectedId, onSelect }: ReportListProps) {
  return (
    <section className="panel reports">
      <header className="panel-head">
        <h2>Processed reports</h2>
        <p className="muted">
          One row per distinct issue. Duplicates increment <code>match_count</code>.
        </p>
      </header>

      {reports.length === 0 ? (
        <p className="empty">No reports yet.</p>
      ) : (
        <ul className="report-list">
          {reports.map((report) => {
            const { structured_report: structured } = report
            const isSelected = selectedId === report.id
            return (
              <li key={report.id}>
                <button
                  type="button"
                  className={[
                    'report-card',
                    highlightId === report.id ? 'is-fresh' : '',
                    isSelected ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelect(isSelected ? null : report.id)}
                >
                  <div className="report-top">
                    <h3>{structured.title}</h3>
                    <span className="count" title="Complaints linked to this report">
                      ×{report.match_count + 1}
                    </span>
                  </div>
                  <p className="report-desc">{structured.description}</p>
                  <div className="tags">
                    <span className="tag">{structured.category}</span>
                    <span className={`tag sentiment-${structured.sentiment}`}>
                      {structured.sentiment}
                    </span>
                    <span className="tag ghost">{report.id.slice(0, 8)}</span>
                  </div>
                  <p className="canonical">
                    <span className="canonical-label">canonical_summary</span>
                    {report.canonical_summary}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
