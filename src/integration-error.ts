export interface SerializedExternalError {
  name?: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: SerializedExternalError;
}

export interface ExternalIntegrationErrorContext {
  integration: string;
  operation: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  attempt?: number;
  maxAttempts?: number;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]"],
  [/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]"],
  [/access[_-]?token["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "access_token=[REDACTED]"],
  [/refresh[_-]?token["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "refresh_token=[REDACTED]"],
];

export function redactExternalErrorText(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function errorCode(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}

export function serializeExternalError(error: unknown, depth = 0): SerializedExternalError {
  if (depth > 4) {
    return { message: "[cause chain truncated]" };
  }

  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return {
      name: error.name,
      message: redactExternalErrorText(error.message),
      code: errorCode(error),
      stack: error.stack ? redactExternalErrorText(error.stack) : undefined,
      cause: cause === undefined ? undefined : serializeExternalError(cause, depth + 1),
    };
  }

  return {
    message: redactExternalErrorText(typeof error === "string" ? error : String(error)),
  };
}

export function formatSerializedExternalError(error: SerializedExternalError): string {
  const nameAndMessage = error.name ? `${error.name}: ${error.message}` : error.message;
  const withCode = error.code ? `${nameAndMessage} code=${error.code}` : nameAndMessage;
  return error.cause ? `${withCode}; cause: ${formatSerializedExternalError(error.cause)}` : withCode;
}

export function formatExternalIntegrationFailure(
  context: ExternalIntegrationErrorContext,
  error: unknown,
): string {
  const parts = [
    `integration=${context.integration}`,
    `operation=${context.operation}`,
    context.provider ? `provider=${context.provider}` : undefined,
    context.model ? `model=${context.model}` : undefined,
    context.endpoint ? `endpoint=${context.endpoint}` : undefined,
    context.attempt !== undefined ? `attempt=${context.attempt}` : undefined,
    context.maxAttempts !== undefined ? `maxAttempts=${context.maxAttempts}` : undefined,
    formatSerializedExternalError(serializeExternalError(error)),
  ].filter((part): part is string => part !== undefined);

  return parts.join(" ");
}

export function externalIntegrationDetails(
  context: ExternalIntegrationErrorContext,
  error: unknown,
): Record<string, unknown> {
  return {
    ...context,
    cause: formatSerializedExternalError(serializeExternalError(error)),
    error: serializeExternalError(error),
  };
}
