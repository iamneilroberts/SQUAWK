import type { LeaderboardAssist, LeaderboardPage } from "./types";

const ASSIST_LABELS: Record<LeaderboardAssist, string> = {
  none: "OFF",
  low: "NAV",
  medium: "FULL",
  high: "HIGH",
};

function score(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

export default function LeaderboardResults({ page }: { page: LeaderboardPage }) {
  return (
    <section className="leaderboard-results" aria-label="Leaderboard standings">
      <div className="leaderboard-partition label">
        <span>{page.partition.classId.toUpperCase()}</span>
        <span>{ASSIST_LABELS[page.partition.highestAssist]}</span>
        <span>{page.partition.scoringVersion}</span>
      </div>
      {page.entries.length === 0 ? (
        <div className="leaderboard-empty">NO ELIGIBLE RESULTS IN THIS PARTITION</div>
      ) : (
        <div className="leaderboard-table-scroll">
          <table className="leaderboard-table">
            <caption className="sr-only">Leaderboard standings</caption>
            <thead>
              <tr><th scope="col">RANK</th><th scope="col">PILOT</th><th scope="col">SCORE</th></tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={entry.resultId}>
                  <td>{entry.rank}</td>
                  <th scope="row">{entry.handle}</th>
                  <td>{score(entry.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
