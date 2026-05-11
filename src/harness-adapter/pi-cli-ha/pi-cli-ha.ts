import type { PiCliHarnessAdapter } from "../../thread-view/domain/pi-thread-view-file.js";

export function createPiCliHarnessAdapter(): PiCliHarnessAdapter {
  return {
    async loadThreadViewFile() {
      throw new Error("Story 5 implements the PI CLI harness adapter.");
    },
  };
}
