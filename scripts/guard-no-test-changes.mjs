import { spawnSync } from "node:child_process";

const testPathspecs = ["tests/*.test.ts", "tests/**/*.test.ts"];

function runGit(args) {
  return spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeStream(stream, writer) {
  const text = stream?.trim();

  if (!text) {
    return;
  }

  writer(`${text}\n`);
}

function readFiles(result) {
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function ensureGitSuccess(result) {
  if (result.status === 0 || result.status === 1) {
    return;
  }

  writeStream(result.stdout, (text) => process.stdout.write(text));
  writeStream(result.stderr, (text) => process.stderr.write(text));
  process.exit(result.status ?? 1);
}

function reportDirtyFiles(label, files) {
  if (files.length === 0) {
    return;
  }

  process.stderr.write(`${label}:\n`);
  process.stderr.write(`${files.join("\n")}\n`);
}

const unstagedDiff = runGit(["diff", "--name-only", "--", ...testPathspecs]);
const stagedDiff = runGit(["diff", "--cached", "--name-only", "--", ...testPathspecs]);
const untrackedTests = runGit(["ls-files", "--others", "--exclude-standard", "--", ...testPathspecs]);

ensureGitSuccess(unstagedDiff);
ensureGitSuccess(stagedDiff);

if (untrackedTests.status !== 0) {
  writeStream(untrackedTests.stdout, (text) => process.stdout.write(text));
  writeStream(untrackedTests.stderr, (text) => process.stderr.write(text));
  process.exit(untrackedTests.status ?? 1);
}

const unstagedFiles = readFiles(unstagedDiff);
const stagedFiles = readFiles(stagedDiff);
const untrackedFiles = readFiles(untrackedTests);

if (unstagedFiles.length > 0 || stagedFiles.length > 0 || untrackedFiles.length > 0) {
  reportDirtyFiles("Unstaged test file changes detected", unstagedFiles);
  reportDirtyFiles("Staged test file changes detected", stagedFiles);
  reportDirtyFiles("Untracked test files detected", untrackedFiles);
  process.exit(1);
}
