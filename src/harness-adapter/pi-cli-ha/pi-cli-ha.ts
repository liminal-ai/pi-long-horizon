import { createStewardIssue } from "../../thread/domain/errors.js";
import type { PiCliHarnessAdapter } from "../../thread-view/domain/pi-thread-view-file.js";
import {
  loadThreadViewFile,
  type LoadThreadViewFileOptions,
} from "./load-thread-view-file.js";

export interface PiCliHarnessAdapterDependencies extends LoadThreadViewFileOptions {}

export function createPiCliHarnessAdapter(
  dependencies: PiCliHarnessAdapterDependencies = {},
): PiCliHarnessAdapter {
  let lastLoadedFilePath: string | undefined;

  return {
    async loadThreadViewFile(input) {
      try {
        await loadThreadViewFile(input, {
          ...dependencies,
          currentSessionFile: dependencies.currentSessionFile ?? (() => lastLoadedFilePath),
          markLoadedFile: (filePath) => {
            lastLoadedFilePath = filePath;
            dependencies.markLoadedFile?.(filePath);
          },
        });

        return {
          ok: true,
        };
      } catch (error) {
        return {
          ok: false,
          issues: [
            createStewardIssue({
              code: "PI_RELOAD_FAILED",
              message: `PI could not load generated Thread View file ${input.filePath}.`,
              threadId: input.threadId,
              cause: error instanceof Error ? error.message : String(error),
            }),
          ],
        };
      }
    },
  };
}
