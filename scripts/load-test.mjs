const url = process.env.LOAD_URL ?? 'http://127.0.0.1:4000/ready';
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 10);
const p95BudgetMs = Number(process.env.LOAD_P95_BUDGET_MS ?? 1000);

const endsAt = Date.now() + durationSeconds * 1000;
const latencies = [];
let errors = 0;

async function worker() {
  while (Date.now() < endsAt) {
    const started = performance.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) errors += 1;
      await response.arrayBuffer();
    } catch {
      errors += 1;
    }
    latencies.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((a, b) => a - b);
const at = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
const result = {
  url,
  concurrency,
  durationSeconds,
  requests: latencies.length,
  errors,
  requestsPerSecond: Number((latencies.length / durationSeconds).toFixed(1)),
  p50Ms: Number(at(0.5).toFixed(1)),
  p95Ms: Number(at(0.95).toFixed(1)),
  p99Ms: Number(at(0.99).toFixed(1)),
  p95BudgetMs,
};
console.log(JSON.stringify(result));
if (errors > 0 || result.p95Ms > p95BudgetMs) process.exit(1);
