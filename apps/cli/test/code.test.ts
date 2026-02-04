import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-code-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Code Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy repo to pass validation
    const repoPath = path.join(tmpDir, "dummy-code-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;
    await Bun.spawn(["git", "commit", "--allow-empty", "-m", "Initial commit", "--author", "Tester <test@example.com>"], { cwd: repoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("code command uses EDITOR env var", async () => {
    const repoPath = path.join(tmpDir, "dummy-code-repo");
    const markerFile = path.join(tmpDir, "editor-was-called");

    // Create a dummy editor script
    const editorScript = path.join(tmpDir, "fake-editor.sh");
    await fs.writeFile(editorScript, `#!/bin/sh\ntouch "${markerFile}"\n`);
    await fs.chmod(editorScript, "755");

    // 1. Add the repo
    const addProc = Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-code-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    });
    await addProc.exited;
    if (addProc.exitCode !== 0) {
        console.error(await new Response(addProc.stderr).text());
    }
    expect(addProc.exitCode).toBe(0);

    // 2. Run code command with custom EDITOR
    const proc = Bun.spawn(["bun", "run", cliEntry, "code", "--tech", "test-code-repo"], {
        env: { ...process.env, HOME: tmpDir, EDITOR: editorScript, VISUAL: "" },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);

    // The repo path in config will be under .config/btca/repos/test-code-repo because we added it as a remote repo
    const expectedRepoPath = path.join(tmpDir, ".config", "btca", "repos", "test-code-repo");
    expect(output).toContain(`Opening test-code-repo at ${expectedRepoPath} in ${editorScript}...`);

    // Wait a bit for the detached process to run
    // Since spawn().unref() is used, the parent process exits immediately.
    // We need to wait for the child process (fake editor) to execute.
    // Since it's just 'touch', it should be fast.
    for (let i = 0; i < 20; i++) {
        const exists = await fs.access(markerFile).then(() => true).catch(() => false);
        if (exists) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const markerExists = await fs.access(markerFile).then(() => true).catch(() => false);
    expect(markerExists).toBe(true);
  });
});
