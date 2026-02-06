import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-explain-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Explain Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("explain fails if file does not exist", async () => {
    const proc = Bun.spawn(["bun", "run", cliEntry, "explain", "-t", "local", "-f", "nonexistent-file.ts"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe",
        cwd: tmpDir
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(stderr).toContain("Error: File not found or unreadable");
  });

  test("explain reads file and proceeds (fails at opencode)", async () => {
     const testFile = path.join(tmpDir, "test.ts");
     await fs.writeFile(testFile, "console.log('hello');");

     // We expect it to fail later in the process (e.g. opencode missing or config error),
     // but NOT fail on file reading.
     const proc = Bun.spawn(["bun", "run", cliEntry, "explain", "-t", "local", "-f", "test.ts"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe",
        cwd: tmpDir
     });

     const stderr = await new Response(proc.stderr).text();
     await proc.exited;

     expect(stderr).not.toContain("Error: File not found or unreadable");
     // It will likely fail with something else, which confirms it passed the file check.
  });
});
