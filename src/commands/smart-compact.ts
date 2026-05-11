import type {
  SmartCompactCommandInput,
  SmartCompactCommandResult,
} from "../thread-view/domain/pi-thread-view-file.js";

export async function runSmartCompact(
  _input: SmartCompactCommandInput,
): Promise<SmartCompactCommandResult> {
  throw new Error("Story 5 implements runSmartCompact.");
}
