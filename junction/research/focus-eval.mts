import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { buildFocus } from "/home/ijtihed/schema-may22/src/trust/focus.ts";
import { loadRequirement } from "/home/ijtihed/schema-may22/src/trust/receipt.ts";
const repo = "/home/ijtihed/junction26-messagepack-csharp";
const base = "32258fdbee4bcd653c79f51b4376b5103c6f4d27";
const src = (files: string[]) => files.filter((f) => /^src\/.*\.(cs|tt)$/.test(f) && !/\.g\.cs$/.test(f));
const runs = readdirSync("/home/ijtihed/schema-may22/junction/agent-runs").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`/home/ijtihed/schema-may22/junction/agent-runs/${f}`, "utf8")));
let tot = 0, hit = 0;
for (const id of ["REQ-2283", "REQ-2234", "REQ-2297", "REQ-2129"]) {
  const req = loadRequirement(id);
  const org = execFileSync("git", ["-C", repo, "diff", "--name-only", base, `origin/${req.branch}`]).toString().split("\n").filter(Boolean);
  const agent = runs.filter((r) => r.requirementId === id && r.filesChanged).flatMap((r) => r.filesChanged as string[]);
  const existed = (f: string) => { try { execFileSync("git", ["-C", repo, "cat-file", "-e", `${base}:${f}`], { stdio: "ignore" }); return true; } catch { return false; } };
  const truth = [...new Set(src([...org, ...agent]))].filter(existed);
  const brief = await buildFocus(repo, base, req);
  const top = brief.files.map((f) => f.path);
  const found = truth.filter((t) => top.includes(t) || (t.endsWith(".tt") && top.includes(t.replace(/\.tt$/, ".cs"))) || (t.endsWith(".cs") && top.includes(t.replace(/\.cs$/, ".tt"))));
  tot += truth.length; hit += found.length;
  console.log(`${id} [${brief.strategy}, ${brief.ms}ms] truth ${truth.length} src files, brief covers ${found.length}`);
  console.log("   brief:", top.map((p) => p.split("/").pop()).join(", "));
  console.log("   truth:", truth.map((p) => p.split("/").pop()).join(", "));
  console.log("   skip :", brief.skipModules.join(", "));
}
console.log(`overall recall@8: ${hit}/${tot}`);
