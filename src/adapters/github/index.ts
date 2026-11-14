// Per architecture/schema-v3.md §3.4
export interface GithubAdapter {
  createPr(opts: { owner: string; repo: string; title: string; body: string; head: string; base: string }): Promise<{ url: string; number: number }>;
}

const real: GithubAdapter = {
  createPr: async () => { throw new Error("GithubAdapter.real not wired yet — ships in Phase 6"); },
};

const demo: GithubAdapter = {
  createPr: async (opts) => ({ url: `https://github.com/${opts.owner}/${opts.repo}/pull/1`, number: 1 }),
};

export const githubAdapterImpls = { real, demo } as const;
