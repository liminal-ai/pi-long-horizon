import type {
  BuildPiThreadViewFileInput,
  PiThreadViewFile,
} from "../../domain/pi-thread-view-file.js";

export async function buildPiThreadViewFile(
  _input: BuildPiThreadViewFileInput,
): Promise<PiThreadViewFile> {
  throw new Error("Story 5 implements buildPiThreadViewFile.");
}
