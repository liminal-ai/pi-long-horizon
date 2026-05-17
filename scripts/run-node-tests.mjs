import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] ?? "service";
const testsRoot = "tests";
const supportedModes = new Set(["service", "e2e"]);

if (!supportedModes.has(mode)) {
  console.error(`Unknown test mode "${mode}". Expected one of: ${[...supportedModes].join(", ")}.`);
  process.exit(1);
}

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
  if (mode === "e2e") {
    return filePath.endsWith(".e2e.test.ts");
  }

  return filePath.endsWith(".test.ts") && !filePath.endsWith(".e2e.test.ts");
}

const testFiles = existsSync(testsRoot) ? listFiles(testsRoot).filter(matchesMode) : [];

if (testFiles.length === 0) {
  console.log(`No ${mode} tests found.`);
  process.exit(0);
}

function runNodeTestJob(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("close", (status) => resolve(typeof status === "number" ? status : 1));
  });
}

if (mode === "e2e") {
  const longThreadFile = "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts";
  const longThreadTests = [
    "real PI execution appends one closed turn to a prepared long-thread clone",
    "real PI execution continues the same prepared long-thread clone session with a second closed turn",
    "smart compact writes a generated rollout after live PI turns on a prepared long-thread clone",
  ];
  const otherFiles = testFiles.filter((filePath) => filePath !== longThreadFile);
  const jobs = [
    ...otherFiles.map((filePath) => ({
      label: filePath,
      args: ["--import", "tsx", "--test", filePath],
    })),
    ...longThreadTests.map((testName) => ({
      label: `${longThreadFile} :: ${testName}`,
      args: ["--import", "tsx", "--test", "--test-name-pattern", `^${testName}$`, longThreadFile],
    })),
  ];
  const statuses = await Promise.all(jobs.map((job) => runNodeTestJob(job.args)));
  process.exit(statuses.every((status) => status === 0) ? 0 : 1);
}

const runnerArgs = ["--import", "tsx", "--test"];
runnerArgs.push(...testFiles);

const result = spawnSync(process.execPath, runnerArgs, {
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
