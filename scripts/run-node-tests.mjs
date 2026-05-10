import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] ?? "unit";
const testsRoot = "tests";

function listFiles(rootDir) {
  const stack = [rootDir];
  const files = [];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      files.push(entryPath);
    }
  }

  return files.sort();
}

function matchesMode(filePath) {
  if (mode === "integration") {
    return filePath.endsWith(".integration.test.ts");
  }

  return filePath.endsWith(".test.ts") && !filePath.endsWith(".integration.test.ts");
}

const testFiles = existsSync(testsRoot) ? listFiles(testsRoot).filter(matchesMode) : [];

if (testFiles.length === 0) {
  console.log(`No ${mode} tests found.`);
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);

