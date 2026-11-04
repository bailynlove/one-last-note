type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0
    ? ''
    : `{${entries.map(([k, v]) => `${k}="${v.replaceAll('"', '\\"')}"`).join(',')}}`;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly collectors = new Set<() => void>();
  private readonly bucketBounds = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  addCollector(collector: () => void): void {
    this.collectors.add(collector);
  }

  inc(name: string, labels: Labels = {}, amount = 1): void {
    const key = `${name}${labelKey(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  gauge(name: string, labels: Labels = {}, value: number): void {
    this.gauges.set(`${name}${labelKey(labels)}`, value);
  }

  observe(name: string, labels: Labels, seconds: number): void {
    const key = `${name}${labelKey(labels)}`;
    const values = this.histograms.get(key) ?? [];
    values.push(seconds);
    if (values.length > 1000) values.shift();
    this.histograms.set(key, values);
  }

  render(): string {
    for (const collector of this.collectors) {
      try {
        collector();
      } catch {
        // A failed collector must not take down the metrics endpoint.
      }
    }
    const lines: string[] = [];
    for (const [key, value] of this.counters) lines.push(`${key} ${value}`);
    for (const [key, value] of this.gauges) lines.push(`${key} ${value}`);
    for (const [key, values] of this.histograms) {
      const name = key.slice(0, key.indexOf('{') === -1 ? key.length : key.indexOf('{'));
      const labels = key.slice(name.length);
      const suffix = labels === '' ? '' : labels.slice(0, -1);
      for (const bound of this.bucketBounds) {
        const count = values.filter((value) => value <= bound).length;
        lines.push(`${name}_bucket${suffix}${suffix ? ',' : '{'}le="${bound}"} ${count}`);
      }
      lines.push(`${name}_bucket${suffix}${suffix ? ',' : '{'}le="+Inf"} ${values.length}`);
      const sum = values.reduce((total, value) => total + value, 0);
      lines.push(`${name}_sum${labels} ${sum}`);
      lines.push(`${name}_count${labels} ${values.length}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export function createMetrics(): Metrics {
  return new Metrics();
}
