import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-web-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Web Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy repo to pass validation
    const repoPath = path.join(tmpDir, "dummy-web-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;
    // Need at least one commit for some git checks maybe?
    await Bun.spawn(["git", "commit", "--allow-empty", "-m", "Initial commit", "--author", "Tester <test@example.com>"], { cwd: repoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("web command attempts to open the correct URL", async () => {
    const repoPath = path.join(tmpDir, "dummy-web-repo");

    // 1. Add the repo
    const addProc = Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-web-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    });
    await addProc.exited;
    if (addProc.exitCode !== 0) {
        console.error(await new Response(addProc.stderr).text());
    }
    expect(addProc.exitCode).toBe(0);

    // 2. Run web command
    const proc = Bun.spawn(["bun", "run", cliEntry, "web", "--tech", "test-web-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    // The command logs: "Opening <URL>..."
    expect(output).toContain(`Opening ${repoPath}...`);
  });
});
