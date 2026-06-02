import path from "node:path";

export const inspectionFixtureDir = path.resolve("test/fixtures/inspection-thread-alpha");
export const inspectionFixtureArgs = ["--root", inspectionFixtureDir, "--thread-dir", inspectionFixtureDir] as const;
