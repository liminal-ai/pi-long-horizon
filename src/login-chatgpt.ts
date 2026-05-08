import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { CHATGPT_CODEX_PROVIDER } from "./pi-baseline.js";

function openBrowser(url: string): void {
  const child = spawn("open", [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

const rl = createInterface({ input, output });
const authStorage = AuthStorage.create();

try {
  await authStorage.login(CHATGPT_CODEX_PROVIDER, {
    onAuth: ({ url, instructions }) => {
      console.log(instructions ?? "Complete ChatGPT login in your browser.");
      console.log(url);
      openBrowser(url);
    },
    onProgress: (message) => {
      console.log(message);
    },
    onPrompt: async (prompt) => {
      return rl.question(`${prompt.message} `);
    },
  });

  console.log("ChatGPT Codex OAuth saved for provider: openai-codex");
} finally {
  rl.close();
}
