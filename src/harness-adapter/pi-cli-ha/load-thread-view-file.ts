import { resolve } from "node:path";

export interface LoadThreadViewFileOptions {
  currentSessionFile?: () => string | undefined;
  markLoadedFile?: (filePath: string) => void;
  switchSession?: (sessionPath: string) => Promise<{ cancelled: boolean }>;
}

export async function loadThreadViewFile(
  input: {
    threadId: string;
    threadViewId: string;
    filePath: string;
  },
  options: LoadThreadViewFileOptions = {},
): Promise<void> {
  const resolvedPath = resolve(input.filePath);

  if (!options.switchSession) {
    throw new Error(
      `PI session switch handler is not configured for generated Thread View file ${resolvedPath}; provide a real PI session switch dependency such as ctx.switchSession.`,
    );
  }

  const result = await options.switchSession(resolvedPath);
  if (result.cancelled) {
    throw new Error(`PI cancelled the session switch for generated Thread View file ${resolvedPath}.`);
  }

  options.markLoadedFile?.(resolvedPath);
}
