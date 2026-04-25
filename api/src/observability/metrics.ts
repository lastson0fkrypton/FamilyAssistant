import type { Request, Response, NextFunction } from 'express';

type Method = string;
type RouteKey = string;

interface RouteStats {
  count: number;
  errors: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface Snapshot {
  processUptimeSeconds: number;
  memoryRssBytes: number;
  memoryHeapUsedBytes: number;
  totalRequests: number;
  totalErrors: number;
  byRoute: Record<string, {
    count: number;
    errors: number;
    avgDurationMs: number;
    maxDurationMs: number;
  }>;
}

class MetricsCollector {
  private readonly startMs = Date.now();
  private readonly routeStats = new Map<RouteKey, RouteStats>();
  private totalRequests = 0;
  private totalErrors = 0;

  record(method: Method, route: string, statusCode: number, durationMs: number): void {
    const key = `${method.toUpperCase()} ${route}`;
    const current = this.routeStats.get(key) ?? {
      count: 0,
      errors: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };

    current.count += 1;
    current.totalDurationMs += durationMs;
    current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);

    this.totalRequests += 1;
    if (statusCode >= 400) {
      current.errors += 1;
      this.totalErrors += 1;
    }

    this.routeStats.set(key, current);
  }

  snapshot(): Snapshot {
    const mem = process.memoryUsage();
    const byRoute: Snapshot['byRoute'] = {};

    for (const [key, stat] of this.routeStats.entries()) {
      byRoute[key] = {
        count: stat.count,
        errors: stat.errors,
        avgDurationMs: stat.count > 0 ? stat.totalDurationMs / stat.count : 0,
        maxDurationMs: stat.maxDurationMs,
      };
    }

    return {
      processUptimeSeconds: (Date.now() - this.startMs) / 1000,
      memoryRssBytes: mem.rss,
      memoryHeapUsedBytes: mem.heapUsed,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      byRoute,
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];
    const snap = this.snapshot();

    lines.push('# HELP familyassistant_process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE familyassistant_process_uptime_seconds gauge');
    lines.push(`familyassistant_process_uptime_seconds ${snap.processUptimeSeconds.toFixed(3)}`);

    lines.push('# HELP familyassistant_requests_total Total HTTP requests handled');
    lines.push('# TYPE familyassistant_requests_total counter');
    lines.push(`familyassistant_requests_total ${snap.totalRequests}`);

    lines.push('# HELP familyassistant_request_errors_total Total HTTP requests with status >= 400');
    lines.push('# TYPE familyassistant_request_errors_total counter');
    lines.push(`familyassistant_request_errors_total ${snap.totalErrors}`);

    lines.push('# HELP familyassistant_memory_rss_bytes Resident set size in bytes');
    lines.push('# TYPE familyassistant_memory_rss_bytes gauge');
    lines.push(`familyassistant_memory_rss_bytes ${snap.memoryRssBytes}`);

    lines.push('# HELP familyassistant_memory_heap_used_bytes Heap used in bytes');
    lines.push('# TYPE familyassistant_memory_heap_used_bytes gauge');
    lines.push(`familyassistant_memory_heap_used_bytes ${snap.memoryHeapUsedBytes}`);

    lines.push('# HELP familyassistant_route_requests_total Route request counts');
    lines.push('# TYPE familyassistant_route_requests_total counter');
    lines.push('# HELP familyassistant_route_errors_total Route error counts');
    lines.push('# TYPE familyassistant_route_errors_total counter');
    lines.push('# HELP familyassistant_route_duration_avg_ms Route average latency in ms');
    lines.push('# TYPE familyassistant_route_duration_avg_ms gauge');

    for (const [route, stats] of Object.entries(snap.byRoute)) {
      const safeRoute = route.replace(/"/g, '\\"');
      lines.push(`familyassistant_route_requests_total{route="${safeRoute}"} ${stats.count}`);
      lines.push(`familyassistant_route_errors_total{route="${safeRoute}"} ${stats.errors}`);
      lines.push(`familyassistant_route_duration_avg_ms{route="${safeRoute}"} ${stats.avgDurationMs.toFixed(3)}`);
    }

    return `${lines.join('\n')}\n`;
  }
}

const collector = new MetricsCollector();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const endedAt = process.hrtime.bigint();
    const durationMs = Number(endedAt - startedAt) / 1_000_000;
    const route = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path as string}`
      : req.path;
    collector.record(req.method, route, res.statusCode, durationMs);
  });

  next();
}

export function getMetricsSnapshot(): Snapshot {
  return collector.snapshot();
}

export function getMetricsPrometheus(): string {
  return collector.toPrometheus();
}
