import { fail, ok, type StewardResult } from "../domain/errors.js";
import { THREAD_SCHEMA_VERSION, type ThreadRecord } from "../domain/records.js";

export const SUPPORTED_THREAD_SCHEMA_VERSIONS = [THREAD_SCHEMA_VERSION] as const;

export function isSupportedThreadSchemaVersion(schemaVersion: string): schemaVersion is typeof THREAD_SCHEMA_VERSION {
  return schemaVersion === THREAD_SCHEMA_VERSION;
}

export function assertSupportedThreadSchemaVersion(thread: Pick<ThreadRecord, "threadId" | "schemaVersion">): StewardResult<
  Pick<ThreadRecord, "threadId" | "schemaVersion">
> {
  if (isSupportedThreadSchemaVersion(thread.schemaVersion)) {
    return ok(thread);
  }

  return fail({
    code: "UNSUPPORTED_SCHEMA_VERSION",
    message: `Thread ${thread.threadId} uses unsupported schema version ${thread.schemaVersion}.`,
    threadId: thread.threadId,
  });
}
