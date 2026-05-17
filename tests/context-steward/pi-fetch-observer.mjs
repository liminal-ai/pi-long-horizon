import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const logPath = process.env.PI_LONG_HORIZON_FETCH_LOG;
const originalFetch = globalThis.fetch;

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]");
}

function serializeError(error, depth = 0) {
  if (depth > 4) {
    return { message: "[cause chain truncated]" };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redact(error.message),
      code: typeof error.code === "string" || typeof error.code === "number" ? String(error.code) : undefined,
      stack: error.stack ? redact(error.stack) : undefined,
      cause: error.cause === undefined ? undefined : serializeError(error.cause, depth + 1),
    };
  }
  return { message: redact(error) };
}

function requestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return String(input);
}

function write(record) {
  if (!logPath) {
    return;
  }
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, "utf8");
}

if (typeof originalFetch === "function") {
  globalThis.fetch = async function observedFetch(input, init) {
    const startedAt = Date.now();
    const url = redact(requestUrl(input));
    const method =
      init?.method ??
      (typeof Request !== "undefined" && input instanceof Request ? input.method : undefined) ??
      "GET";
    const callSite = new Error("fetch call site").stack;
    write({ event: "fetch_start", method, url, callSite: callSite ? redact(callSite) : undefined });
    try {
      const response = await originalFetch(input, init);
      write({ event: "fetch_response", method, url, status: response.status, ok: response.ok, elapsedMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      write({ event: "fetch_error", method, url, elapsedMs: Date.now() - startedAt, error: serializeError(error) });
      throw error;
    }
  };
}
