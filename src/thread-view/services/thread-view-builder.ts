import type {
  ThreadViewBuildInputs,
  ThreadViewBuildResult,
} from "../domain/pi-thread-view-file.js";

export async function buildDraftThreadView(
  _input: ThreadViewBuildInputs,
): Promise<ThreadViewBuildResult> {
  throw new Error("Story 4 implements buildDraftThreadView.");
}
