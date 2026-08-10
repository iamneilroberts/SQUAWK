import type { ProfileClassStatistic, ProfileFlightHistoryEntry } from "./results";

function score(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 1_000) / 1_000);
}

function completedAt(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default function ProfileResults({
  history,
  statistics,
}: {
  history: ProfileFlightHistoryEntry[];
  statistics: ProfileClassStatistic[];
}) {
  if (history.length === 0) {
    return (
      <section className="profile-results" aria-label="Flight results">
        <div className="label">FLIGHT HISTORY</div>
        <div className="profile-empty">NO COMPLETED FLIGHTS</div>
      </section>
    );
  }

  return (
    <section className="profile-results" aria-label="Flight results">
      <div className="label">CLASS STATISTICS</div>
      <div className="profile-statistics">
        {statistics.map((item) => (
          <div className="profile-statistic" key={item.classId}>
            <strong>{item.classId.toUpperCase()}</strong>
            <span>{item.completedFlights} FLIGHTS</span>
            <span>{item.successfulLandings} LANDED</span>
            <span>{item.rankedFlights} RANKED</span>
            <span>BEST {score(item.bestScore)}</span>
            <span>AVG {score(item.averageScore)}</span>
          </div>
        ))}
      </div>
      <div className="label">FLIGHT HISTORY</div>
      <div className="profile-history" role="list">
        {history.map((item) => (
          <div className="profile-history-row" role="listitem" key={item.resultId}>
            <div>
              <strong>{item.classId.toUpperCase()} · {item.outcome.toUpperCase()}</strong>
              <span>{completedAt(item.completedAt)} · {item.highestAssist.toUpperCase()}</span>
            </div>
            <div>
              <strong>{item.score === null ? item.failure ?? item.evidenceStatus.toUpperCase() : score(item.score)}</strong>
              <span>{item.ranked ? "RANKED" : "NOT RANKED"}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
