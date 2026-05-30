#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { AuthStorage } from "@earendil-works/pi-coding-agent";

function write(message) {
  output.write(message);
}

async function readSecret(prompt) {
  write(prompt);

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return new Promise((resolve) => {
      let value = "";
      input.setEncoding("utf8");
      input.resume();
      input.on("data", (chunk) => {
        value += chunk;
        if (value.includes("\n")) {
          input.pause();
          resolve(value.trim());
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    let value = "";

    function cleanup() {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
    }

    function onData(chunk) {
      const text = chunk.toString("utf8");
      for (const char of text) {
        const code = char.charCodeAt(0);
        if (char === "\r" || char === "\n") {
          cleanup();
          write("\n");
          resolve(value.trim());
          return;
        }
        if (code === 3) {
          cleanup();
          write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (code === 127 || code === 8) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

const key = await readSecret("Paste Anthropic API key: ");
if (!key.startsWith("sk-ant-")) {
  throw new Error("That does not look like an Anthropic API key.");
}

const auth = AuthStorage.create(`${process.env.HOME}/.pi/agent/auth.json`);
auth.set("anthropic", { type: "api_key", key });

const status = auth.getAuthStatus("anthropic");
if (!status.configured) {
  throw new Error("Anthropic API key was not stored.");
}

write("Stored Anthropic API key in ~/.pi/agent/auth.json.\n");
