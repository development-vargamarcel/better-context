import { Effect } from "effect";
import { ConfigError } from "../errors";

/**
 * Clones a repository.
 */
export const cloneRepo = (args: {
  repoDir: string;
  url: string;
  branch: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const { repoDir, url, branch } = args;
      const proc = Bun.spawn([
        "git",
        "clone",
        "--branch",
        branch,
        url,
        repoDir,
      ]);
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git clone failed with exit code ${exitCode}`);
      }
    },
    catch: (error) =>
      new ConfigError({ message: "Failed to clone repo", cause: error }),
  });

/**
 * Pulls a repository.
 */
export const pullRepo = (args: { repoDir: string; branch: string }) =>
  Effect.tryPromise({
    try: async () => {
      const { repoDir, branch } = args;
      const proc = Bun.spawn(["git", "pull", "origin", branch], {
        cwd: repoDir,
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git pull failed with exit code ${exitCode}`);
      }
    },
    catch: (error) =>
      new ConfigError({ message: "Failed to pull repo", cause: error }),
  });

/**
 * Validates a repository URL.
 */
export const validateRepo = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", "ls-remote", url], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git ls-remote failed with exit code ${exitCode}`);
      }
    },
    catch: (error) =>
      new ConfigError({ message: "Failed to validate repo", cause: error }),
  });

/**
 * Fetches updates from the remote repository.
 */
export const fetchRepo = (args: { repoDir: string }) =>
  Effect.tryPromise({
    try: async () => {
      const { repoDir } = args;
      const proc = Bun.spawn(["git", "fetch", "origin"], {
        cwd: repoDir,
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git fetch failed with exit code ${exitCode}`);
      }
    },
    catch: (error) =>
      new ConfigError({ message: "Failed to fetch repo", cause: error }),
  });

/**
 * Gets the status of the repository (ahead/behind/dirty).
 */
export const getRepoStatus = (args: { repoDir: string; branch: string }) =>
  Effect.tryPromise({
    try: async () => {
      const { repoDir, branch } = args;

      // Check for dirty state
      const procStatus = Bun.spawn(["git", "status", "-uno", "--porcelain"], {
        cwd: repoDir,
      });
      const statusOutput = await new Response(procStatus.stdout).text();
      await procStatus.exited;
      const dirty = statusOutput.trim().length > 0;

      // Check ahead/behind
      // git rev-list --left-right --count HEAD...origin/main
      const procRev = Bun.spawn(
        [
          "git",
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...origin/${branch}`,
        ],
        { cwd: repoDir }
      );
      const revOutput = await new Response(procRev.stdout).text();
      await procRev.exited;

      let ahead = 0;
      let behind = 0;

      if (procRev.exitCode === 0) {
        const parts = revOutput.trim().split(/\s+/);
        if (parts.length >= 2) {
          ahead = parseInt(parts[0]!, 10);
          behind = parseInt(parts[1]!, 10);
        }
      }

      return { dirty, ahead, behind };
    },
    catch: (error) =>
      new ConfigError({ message: "Failed to get repo status", cause: error }),
  });
