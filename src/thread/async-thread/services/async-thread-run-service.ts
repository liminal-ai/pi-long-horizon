import type {
  PrepareAsyncThreadInput,
  PrepareAsyncThreadResult,
} from "../domain/async-thread-status.js";

export async function prepareAsyncThread(
  _input: PrepareAsyncThreadInput,
): Promise<PrepareAsyncThreadResult> {
  throw new Error("Stories 5 and 6 implement prepareAsyncThread.");
}
