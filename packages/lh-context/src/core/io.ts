import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { LhxError } from "../errors/errors.js";
import type { InspectInput } from "../types/public.js";

export async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function readJsonl(filePath: string): Promise<unknown[]> {
  if (!(await exists(filePath))) return [];
  const text = await readFile(filePath, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function maybeReadJson<T = unknown>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) return undefined;
  return readJson<T>(filePath);
}

export interface LoadedThread {
  rootDir: string;
  contextStewardDir: string;
  threadDir: string;
  threadId: string;
  thread: any;
  turns: any[];
  chunks: any[];
  messages: any[];
  generatedFilePath?: string;
  generatedRecords: any[];
  warnings: string[];
}

export async function loadThread(input: InspectInput, options: { preferGeneratedThreadView?: boolean } = {}): Promise<LoadedThread> {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const contextStewardDir = path.join(rootDir, ".context-steward");
  const threadDir = input.threadDir ? path.resolve(input.threadDir) : await resolveThreadDir(contextStewardDir, input.threadId, rootDir, options);
  const thread = await readJson<any>(path.join(threadDir, "thread.json"));
  const threadId = input.threadId ?? thread.threadId ?? path.basename(threadDir);
  const turns = (await maybeReadJson<any[]>(path.join(threadDir, "turns.json"))) ?? [];
  const chunks = (await maybeReadJson<any[]>(path.join(threadDir, "chunks.json"))) ?? [];
  const messages = await readJsonl(path.join(threadDir, "messages.jsonl"));
  const warnings: string[] = [];
  const rawGeneratedFilePath = input.threadViewPath ? path.resolve(input.threadViewPath) : thread?.target?.currentGeneratedFilePath;
  const generatedFilePath = rawGeneratedFilePath && path.isAbsolute(rawGeneratedFilePath) ? rawGeneratedFilePath : rawGeneratedFilePath ? path.resolve(rootDir, rawGeneratedFilePath) : undefined;
  let generatedRecords: any[] = [];
  if (generatedFilePath) {
    if (await exists(generatedFilePath)) generatedRecords = await readJsonl(generatedFilePath);
    else warnings.push(`Generated thread-view file not found: ${generatedFilePath}`);
  } else {
    warnings.push("No generated thread-view file path found on input or thread target metadata.");
  }
  return { rootDir, contextStewardDir, threadDir, threadId, thread, turns, chunks, messages, generatedFilePath, generatedRecords, warnings };
}

async function resolveThreadDir(contextStewardDir: string, threadId: string | undefined, rootDir: string, options: { preferGeneratedThreadView?: boolean }): Promise<string> {
  const threadsDir = path.join(contextStewardDir, "threads");
  if (threadId) return path.join(threadsDir, threadId);
  if (!(await exists(threadsDir))) throw new LhxError(`No Context Steward threads directory at ${threadsDir}`, "NO_THREADS_DIR");
  const entries = await readdir(threadsDir);
  const candidates: Array<{ dir: string; threadId: string; updatedAt: string; mtimeMs: number; hasGeneratedThreadView: boolean }> = [];
  for (const entry of entries.sort()) {
    const dir = path.join(threadsDir, entry);
    const s = await stat(dir).catch(() => undefined);
    if (!s?.isDirectory()) continue;
    const thread = await maybeReadJson<any>(path.join(dir, "thread.json"));
    if (!thread) continue;
    candidates.push({ dir, threadId: thread.threadId ?? entry, updatedAt: thread.updatedAt ?? "", mtimeMs: s.mtimeMs, hasGeneratedThreadView: await generatedThreadViewExists(rootDir, thread) });
  }
  if (candidates.length === 0) throw new LhxError(`No thread.json files found under ${threadsDir}`, "NO_THREADS");
  candidates.sort((a, b) => ((options.preferGeneratedThreadView ? Number(b.hasGeneratedThreadView) - Number(a.hasGeneratedThreadView) : 0) || b.updatedAt.localeCompare(a.updatedAt) || a.threadId.localeCompare(b.threadId) || b.mtimeMs - a.mtimeMs));
  return candidates[0]!.dir;
}

async function generatedThreadViewExists(rootDir: string, thread: any): Promise<boolean> {
  const raw = thread?.target?.currentGeneratedFilePath;
  if (typeof raw !== "string" || raw.length === 0) return false;
  const filePath = path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
  return exists(filePath);
}
