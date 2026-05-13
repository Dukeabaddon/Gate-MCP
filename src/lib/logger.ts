/**
 * Logger utility for Gate-MCP.
 *
 * CRITICAL: stdout is reserved for JSON-RPC protocol communication.
 * ALL logging MUST go through console.error.
 * Using console.log will crash the MCP transport (especially Antigravity).
 */

const SUPPRESS_LOGS = process.env.DISABLE_CONSOLE_OUTPUT === "true";

function timestamp(): string {
  return new Date().toISOString();
}

export function info(message: string, ...args: unknown[]): void {
  if (SUPPRESS_LOGS) return;
  console.error(`[gate-mcp] [INFO]  ${timestamp()} ${message}`, ...args);
}

export function warn(message: string, ...args: unknown[]): void {
  if (SUPPRESS_LOGS) return;
  console.error(`[gate-mcp] [WARN]  ${timestamp()} ${message}`, ...args);
}

export function error(message: string, ...args: unknown[]): void {
  // Errors are always logged, even when DISABLE_CONSOLE_OUTPUT is set,
  // because errors indicate something the operator must know about.
  console.error(`[gate-mcp] [ERROR] ${timestamp()} ${message}`, ...args);
}

export function debug(message: string, ...args: unknown[]): void {
  if (SUPPRESS_LOGS) return;
  if (process.env.LOG_LEVEL === "debug") {
    console.error(`[gate-mcp] [DEBUG] ${timestamp()} ${message}`, ...args);
  }
}

export const logger = { info, warn, error, debug };
export default logger;
