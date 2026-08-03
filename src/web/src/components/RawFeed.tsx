import type { ComplaintRecord } from '../lib/pipeline'

interface RawFeedProps {
  complaints: ComplaintRecord[]
  /** When set, only complaints linked to this report are shown. */
  filterReportId: string | null
  onClearFilter: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function RawFeed({ complaints, filterReportId, onClearFilter }: RawFeedProps) {
  const visible = filterReportId
    ? complaints.filter((complaint) => complaint.processed_report_id === filterReportId)
    : complaints

  return (
    <section className="panel feed">
      <header className="panel-head feed-head">
        <div>
          <h2>Raw complaints</h2>
          <p className="muted">Every inbound message, kept verbatim.</p>
        </div>
        {filterReportId && (
          <button type="button" className="chip" onClick={onClearFilter}>
            Clear filter · {filterReportId.slice(0, 8)}
          </button>
        )}
      </header>

      {visible.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        <table className="feed-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Raw text</th>
              <th>Status</th>
              <th>Report</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((complaint) => (
              <tr key={complaint.id}>
                <td className="mono nowrap">{formatTime(complaint.received_at)}</td>
                <td className="raw-text">{complaint.raw_text}</td>
                <td>
                  <span className={`status status-${complaint.status}`}>
                    {complaint.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="mono nowrap">
                  {complaint.processed_report_id
                    ? complaint.processed_report_id.slice(0, 8)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
