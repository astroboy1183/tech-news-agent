export type RunRecord = {
  stage: string;
  startedAt: number;
  counts?: Record<string, number>;
  error?: string;
};

/** Every stage writes one row here. `/health` and the dashboard read it. */
export async function recordRun(env: Env, run: RunRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs (stage, started_at, ended_at, counts_json, error)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      run.stage,
      Math.floor(run.startedAt / 1000),
      Math.floor(Date.now() / 1000),
      JSON.stringify(run.counts ?? {}),
      run.error ?? null,
    )
    .run();
}
