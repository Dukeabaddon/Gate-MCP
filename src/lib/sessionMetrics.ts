/**
 * Process-local measurements for gate_session_stats.
 *
 * Persistent cache totals answer "what has this cache saved over time?".
 * These counters answer the narrower, independently verifiable question:
 * "what did this MCP server process actually consider and return?"
 */

export interface CompressionMeasurement {
  inputBytes: number;
  outputBytes: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  elapsedMs: number;
  compressed: boolean;
  cacheHit: boolean;
}

export interface SessionMeasurements {
  filesConsidered: number;
  filesCompressed: number;
  inputBytes: number;
  outputBytes: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  cacheHits: number;
  elapsedMs: number;
  sessionElapsedMs: number;
}

let startedAt = Date.now();

let measurements: Omit<SessionMeasurements, "sessionElapsedMs"> = {
  filesConsidered: 0,
  filesCompressed: 0,
  inputBytes: 0,
  outputBytes: 0,
  estimatedTokensBefore: 0,
  estimatedTokensAfter: 0,
  cacheHits: 0,
  elapsedMs: 0,
};

export function recordCompressionMeasurement(
  measurement: CompressionMeasurement
): void {
  measurements.filesConsidered += 1;
  if (measurement.compressed) measurements.filesCompressed += 1;
  if (measurement.cacheHit) measurements.cacheHits += 1;
  // Every request contributes its actual input and serialized result payload.
  // Cache hits avoid recompression work, but still read/hash the input and
  // return a result to the caller, so omitting them would understate traffic.
  measurements.inputBytes += Math.max(0, measurement.inputBytes);
  measurements.outputBytes += Math.max(0, measurement.outputBytes);
  measurements.estimatedTokensBefore += Math.max(
    0,
    measurement.estimatedTokensBefore
  );
  measurements.estimatedTokensAfter += Math.max(
    0,
    measurement.estimatedTokensAfter
  );
  measurements.elapsedMs += Math.max(0, measurement.elapsedMs);
}

export function getSessionMeasurements(): SessionMeasurements {
  return {
    ...measurements,
    sessionElapsedMs: Math.max(0, Date.now() - startedAt),
  };
}

/** Test-only reset for deterministic assertions. */
export function _resetSessionMeasurementsForTests(): void {
  startedAt = Date.now();
  measurements = {
    filesConsidered: 0,
    filesCompressed: 0,
    inputBytes: 0,
    outputBytes: 0,
    estimatedTokensBefore: 0,
    estimatedTokensAfter: 0,
    cacheHits: 0,
    elapsedMs: 0,
  };
}
