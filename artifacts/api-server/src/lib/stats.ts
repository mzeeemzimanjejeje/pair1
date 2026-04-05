const startTime = Date.now();
const visitors = new Set<string>();
let totalRequests = 0;
let totalSuccess = 0;
let totalFailed = 0;

export function recordRequest(ip: string, statusCode: number) {
  totalRequests++;
  visitors.add(ip);
  if (statusCode >= 200 && statusCode < 400) {
    totalSuccess++;
  } else {
    totalFailed++;
  }
}

export function getStats() {
  return {
    status: "online" as const,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    visitors: visitors.size,
    requests: totalRequests,
    success: totalSuccess,
    failed: totalFailed,
  };
}
