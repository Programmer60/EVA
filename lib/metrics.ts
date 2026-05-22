let client: any;
try {
  // @ts-ignore
  client = require("prom-client");
} catch (e) {
  client = null;
}

// Provide a no-op fallback when prom-client is not available (useful in test environments)
class NoopMetric {
  labels(..._args: any[]) {
    return this;
  }
  inc(_v?: number) {}
  observe(_v: number) {}
}

const noopRegister = {
  metrics: async () => "",
};

export const register = client ? client.register : noopRegister;
if (client) {
  client.collectDefaultMetrics({ register, timeout: 5000 });
}

export const providerErrorCounter = client
  ? new client.Counter({
      name: "eva_provider_errors_total",
      help: "Total provider errors",
      labelNames: ["provider", "status"],
    })
  : new NoopMetric();

export const providerFailureCounter = client
  ? new client.Counter({
      name: "eva_provider_failures_total",
      help: "Total provider failure events (used to mark down providers)",
      labelNames: ["provider"],
    })
  : new NoopMetric();

export const providerLatency = client
  ? new client.Histogram({
      name: "eva_provider_latency_seconds",
      help: "Provider call latency in seconds",
      labelNames: ["provider", "model"],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    })
  : new NoopMetric();
