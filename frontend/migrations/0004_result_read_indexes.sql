CREATE INDEX idx_missions_leaderboard_partition
  ON missions(aircraft_class, scoring_version, status, id);

CREATE INDEX idx_flight_results_leaderboard_order
  ON flight_results(highest_assist, outcome, evidence_status, score DESC, created_at ASC, id ASC);
