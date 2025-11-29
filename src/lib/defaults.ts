import type { Repo } from "./types";

export const defaultRepos = {
  effect: {
    name: "effect",
    url: "https://github.com/Effect-TS/effect",
    branch: "main",
  },
  opencode: {
    name: "opencode",
    url: "https://github.com/sst/opencode",
    branch: "production",
  },
  svelte: {
    name: "svelte",
    url: "https://github.com/sveltejs/svelte.dev",
    branch: "main",
  },
  daytona: {
    name: "daytona",
    url: "https://github.com/daytonaio/daytona",
    branch: "main",
  },
} satisfies Record<string, Repo>;
