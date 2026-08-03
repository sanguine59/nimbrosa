interface StatsProps {
  complaintCount: number
  reportCount: number
}

export function Stats({ complaintCount, reportCount }: StatsProps) {
  // Share of complaints that folded into an existing report instead of opening
  // a new one — the number the whole pipeline exists to move.
  const dedupeRate =
    complaintCount === 0 ? 0 : ((complaintCount - reportCount) / complaintCount) * 100

  const tiles = [
    { label: 'Raw complaints', value: String(complaintCount) },
    { label: 'Distinct reports', value: String(reportCount) },
    { label: 'Deduplicated', value: `${dedupeRate.toFixed(0)}%` },
  ]

  return (
    <div className="stats">
      {tiles.map((tile) => (
        <div className="stat" key={tile.label}>
          <span className="stat-value">{tile.value}</span>
          <span className="stat-label">{tile.label}</span>
        </div>
      ))}
    </div>
  )
}
