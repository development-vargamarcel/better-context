import { Effect } from "effect";
import { ConfigError } from "../errors";

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
