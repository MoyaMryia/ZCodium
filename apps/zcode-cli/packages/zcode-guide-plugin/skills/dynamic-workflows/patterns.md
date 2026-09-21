# Dynamic workflow patterns

A catalogue of orchestration shapes. Each entry states when the shape fits, then shows it written correctly. Interfaces are elided where they are obvious — your script still has to define every type it names.

These snippets are **fragments, not runnable scripts**: they name types and subagents that the surrounding prose leaves to you. Complete scripts live in `examples.md`.

For the API surface itself, read the `CreateWorkflow` tool description. For the reasoning behind these choices, read `SKILL.md`.

---

## 1. Fan-out / fan-in over a glob

**When:** one independent question applies to every file in a set, and you want the answers at once.

```ts
phase("Find the files to audit");
const paths = await files.glob("src/**/*.ts");
log(`fanning out over ${paths.length} files`);

phase("Security-audit each file independently");
const verdicts = await Promise.all(
  paths.map((p) =>
    agent(`auditor-${p}`).ask<Verdict>(`Security-review ${p}. Report only real issues.`),
  ),
);

phase("Report the files that failed");
return verdicts.filter((v) => !v.approved).map((v) => ({ path: v.path, reason: v.reason }));
```

A fresh subagent per path is the entire point: the questions share nothing, so there is nothing to pass along and everything to run at once. Do not hoist `agent(...)` above the `map`.

The name carries the path because subagent names must be unique within a run. `agent("auditor")` inside the `map` would create one subagent per file all claiming the same name, which the compiler rejects. `` `auditor-${p}` `` is also what lets a revised re-run (`AmendWorkflow`) retain the verdicts for files whose question stayed the same. Anonymous — `agent()` — is legal too, and starts every file from an empty context.

**Narrow before you fan out.** A glob over a large repository is a large fan-out. When only some files could possibly matter, find them first:

```ts
const hits = await files.grep("dangerouslySetInnerHTML", "src/**/*.tsx");
const paths = [...new Set(hits.map((h) => h.path))];
```

`files.grep` fails rather than truncating when it overruns its cap, so an over-broad pattern errors loudly instead of handing you a partial file list to fan out over.

---

## 2. Changed-file review sweep

**When:** reviewing work in progress rather than the whole tree.

```ts
phase("Find the work in progress");
let paths: string[];
try {
  paths = await git.changedFiles("origin/main");
} catch {
  paths = await files.glob("src/**/*.ts");
}

phase("Review each changed file for bugs");
const reviews = await Promise.all(
  paths.map((p) => agent(`reviewer-${p}`).ask<Review>(`Review ${p} for correctness bugs.`)),
);
```

Every `git` call rejects outside a repository, or when no `git` is available, so the `try`/`catch` with a `files.glob` fallback is the idiom rather than defensive padding.

When the reviewer needs the change rather than the file, hand it the diff — but per path, so no single prompt carries the whole changeset:

```ts
const perFile = await Promise.all(
  paths.map(async (p) => {
    const patch = await git.diff("origin/main", p);
    return agent(`reviewer-${p}`).ask<Review>(`Review this change to ${p}:\n\n${patch}`);
  }),
);
```

`git.diff` is capped and fails rather than truncating, so narrow it to a path whenever the whole-workspace diff would be large.

Then confirm before reporting — per file, as each review lands, rather than after all of them. The reviewer that raised a finding does not get to confirm it, because a subagent asked to check its own work grades generously. Each finding goes instead to a fresh confirmer that reproduces it from the evidence alone and is told not to fix anything. Chaining the confirmers inside the same callback means the slowest reviewer holds up only its own file:

```ts
phase("Review each changed file and confirm its findings as they land");
const confirmed = (
  await Promise.all(
    paths.map(async (p) => {
      const review = await agent(`reviewer-${p}`).ask<Review>(`Review ${p} for correctness bugs.`);
      return Promise.all(
        review.findings.map(async (finding, index) => {
          const check = await agent(`confirmer-${p}-${index}`).ask<Confirmation>(
            `Reproduce this finding from its evidence alone. Do not edit any file.\n${JSON.stringify(finding)}`,
          );
          const reported = { ...finding, status: check.reproduced ? "verified" : "unconfirmed" };
          report(reported);
          return reported;
        }),
      );
    }),
  )
).flat();
```

Whatever fails confirmation is kept and labelled, not dropped. The review fan-out above and this one are one shape written twice for exposition; a real script needs only this one.

---

## 3. Planner ↔ reviewer loop

**When:** a first attempt is rarely right, and a critic can say why.

```ts
const planner = agent("planner", "You write concrete, minimal implementation plans.");
const reviewer = agent("reviewer", "You find the flaw in a plan. Approve only when you cannot. You never edit files.");

let feedback = "none";
for (let round = 0; round < 5; round++) {
  phase("Draft a plan for the change");
  const plan = await planner.ask<Plan>(`Plan the change. Previous critique: ${feedback}`);
  phase("Critique the plan until it holds");
  const review = await reviewer.ask<Review>(`Critique this plan:\n${JSON.stringify(plan)}`);
  if (review.approved) return plan;
  log(`round ${round + 1} rejected: ${review.feedback}`);
  feedback = review.feedback;
}
```

Both subagents are created **once, outside the loop**, and that is what makes the loop cheap: each keeps its accumulated context across rounds, so the planner remembers what it already tried and the reviewer remembers what it already objected to. Creating them inside the loop discards all of it every round and pays full price.

The reviewer's persona states that it never edits files, which is what keeps it critiquing the plan instead of quietly "fixing" it. When critiquing the plan means reading a string, it simply never opens a file; when the plan concerns code, tell it to read the code — a reviewer that has not opened the files can judge whether the plan is coherent, but not whether it is right.

By the final round the persistent reviewer is anchored on its own earlier objections. Put the finished plan in front of eyes that have seen nothing else, and ask for failures rather than approval:

```ts
phase("Independent review of the final plan");
const second = await agent("independent-reviewer", "You review plans and never edit files.").ask<Review>(
  `You have not seen this plan before. Read it against the codebase. What would break it, and what is missing?
${JSON.stringify(plan)}`,
);
if (!second.approved) feedback = second.feedback;
```

---

## 4. Judge panel: independent, or calibrated

**When:** a finding needs a second opinion. Two shapes, and the difference matters.

**Independent** — N fresh contexts, each blind to the others. Use for a majority vote, where correlated judges would defeat the purpose:

```ts
phase("Judge the finding from three angles");
const votes = await Promise.all(
  ["correctness", "security", "does-it-reproduce"].map((lens) =>
    agent(`judge-${lens}`)
      .ask<Verdict>(`Judge this finding through the ${lens} lens. Try to refute it:\n${claim}`),
  ),
);
const survives = votes.filter((v) => !v.refuted).length >= 2;
```

A distinct lens per judge beats three identical refuters: diversity catches failure modes redundancy cannot.

**Calibrated** — one context that sees every item, so its verdicts agree with each other. Use for ranking and severity, where "high" has to mean the same thing twice:

```ts
phase("Rank every finding on one scale");
const triage = agent("triage", "You rank findings on one consistent scale across a whole batch.");

const ranked: Ranked[] = [];
for (const finding of findings) {
  ranked.push(await triage.ask<Ranked>(`Rank: ${JSON.stringify(finding)}`));
}
```

The `for`/`await` is deliberate: asks on a single subagent queue FIFO regardless, so writing it as a `Promise.all` would only hide the serialization rather than remove it.

A queue is not a barrier, however. The calibrated subagent need not hold the whole batch before starting. Feed it each item as the preceding stage produces it — from inside that stage's fan-out callback, SKILL.md §11 — and its verdicts stay consistent while the pipeline keeps moving.

Either way, a judge's verdict is a judgement rather than a reproduction: a finding that survived the panel still enters the report as `unconfirmed` unless a confirmer or a `world.run` check reproduced it.

---

## 5. Loop until approved, with a real escape

**When:** a bounded loop that still has to return something useful once its rounds run out.

```ts
let best: Attempt | undefined;
for (let round = 0; round < 6; round++) {
  phase("Attempt the fix");
  const attempt = await worker.ask<Attempt>(`Attempt the fix. Prior failure: ${lastError ?? "none"}`);
  phase("Check whether it actually passes");
  const check = await checker.ask<Check>(`Does this pass? ${JSON.stringify(attempt)}`);
  if (check.passed) return { attempt, rounds: round + 1, converged: true };
  best = attempt;
  lastError = check.reason;
}
return { attempt: best, rounds: 6, converged: false };
```

Return the shape that states **whether it converged**, not merely the result. A caller unable to separate "approved on round two" from "gave up after six" will read the second as the first. Never let the loop fall off the end returning nothing.

---

## 6. Staged pipeline with typed handoff

**When:** every stage narrows or transforms what the following one works on.

```ts
phase("Survey which modules touch auth");
const survey = await agent("surveyor").ask<Survey>("List the modules that touch auth.");
log(`${survey.modules.length} modules in scope`);

phase("Analyse each module for auth bypasses");
const analyses = await Promise.all(
  survey.modules.map((m) =>
    agent(`analyst-${m.path}`).ask<Analysis>(
      `Analyse ${m.path} for auth bypasses. Purpose: ${m.purpose}`,
    ),
  ),
);

phase("Write the findings up for the engineer who fixes them");
const synth = agent("synthesist", "You write findings up for an engineer who will fix them.");
return synth.ask<Writeup>(`Write these up, deduplicated:\n${JSON.stringify(analyses)}`);
```

Each stage's result is the next stage's input, and the type argument is what makes the handoff safe — `survey.modules.map` compiles only because `Survey` declares what came back.

Note the shape of the last call: one synthesis subagent receives everything at once, because deduplicating across findings is exactly the job that must see all of them. Do not parallelize a stage whose entire purpose is cross-item comparison.

The converse holds too. The analysis stage maps one to one onto the survey's modules, so a per-module check following it belongs inside the same callback as the analysis rather than behind a second `Promise.all` (shape 10). Reserve the barrier for the stage that needs everyone.

---

## 7. Bounded discovery

**When:** the work has no natural size — "find the bugs" rather than "check these twelve files."

```ts
const MAX_ROUNDS = 6;
const found: Bug[] = [];
const seen = new Set<string>();

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Hunt for bugs not already found");
  const batch = await agent("hunter").ask<Bugs>(
    `Find bugs not already in this list: ${JSON.stringify([...seen])}`,
  );
  const fresh = batch.bugs.filter((b) => !seen.has(`${b.path}:${b.line}`));
  if (fresh.length === 0) break; // dry: stop, the remaining rounds would only repeat

  for (const bug of fresh) {
    seen.add(`${bug.path}:${bug.line}`);
    report(bug);
    found.push(bug);
  }
  log(`${found.length} found after round ${round}`);
}
return found;
```

Two guards, and both are needed. The round cap stops the loop running forever while the hunter keeps finding things. The dry check stops it once the hunter stops finding anything new. The cap is a knob you pick and amend inside the script — the harness enforces no node limit, so a loop without one ends only when the user cancels the run. Deduplicate against everything **seen** rather than everything kept: deduping against the kept list makes rejected findings reappear every round and the loop never converges.

---

## 8. Salvage by report

**When:** always, in any run long enough to fail partway.

```ts
// Wrong: forty tasks of work, and a failure on task twelve returns nothing.
const results: Result[] = [];
for (const item of items) results.push(await worker.ask<Result>(`Handle ${item.id}`));
return results;

// Right: each result is published the moment it exists.
phase("Handle each item and publish as it lands");
const results: Result[] = [];
for (const item of items) {
  const result = await worker.ask<Result>(`Handle ${item.id}`);
  report(result);
  results.push(result);
}
return results;
```

Reported items arrive with the completion notification on errored and stopped runs as well as successful ones, and they are recorded, so a resumed run does not re-emit them. The return value survives only if the script reaches its `return`; reported items survive either way. Report findings rather than chatter — there is a per-run item cap, and overrunning it fails the run.

The same call can feed a picture. Tag the item with a preset artifact id — `report(result, "progress")` — and it lands both in the run's results and on the chart, table, metrics or board of that name, live as the loop runs (SKILL.md §10).

A `try`/`catch` around a single task converts one **logic** failure — a subagent result that failed validation, a gate that did not pass, a world read over its cap, an artifact publish whose file is missing — into a partial result instead of a dead run. It is not for provider errors: model-side errors never reach the script. Transient ones (rate limits, overload, network errors, timeouts, unknown provider errors) are retried by the runtime without limit. Deterministic ones (sign-in expired, model not in the plan, quota cap) stop the whole run as `stopped`, so the user can fix the cause and resume. A retry loop around an ask for their sake is dead code. One model-adjacent error is catchable: `ContextLimit`, meaning the ask itself was too large for the model even after compaction. The fix is a smaller ask.

```ts
for (const item of items) {
  try {
    report(await worker.ask<Result>(`Handle ${item.id}`));
  } catch (error) {
    log(`skipped ${item.id}: ${String(error)}`);
  }
}
```

---

## 9. Gated verifier loop (world.run)

**When:** the stopping condition is machine-checkable — a build, a proof checker, a test suite — and a subagent's claim of success deserves no trust.

```ts
const prover = agent("prover", "You repair the proof. Fix exactly what the checker reports.");

phase("Write the first proof attempt");
await prover.ask<Attempt>(`Prove the open theorem in ${FILE}.`);
let clean = false;
for (let round = 1; round <= 8; round++) {
  phase("Check the file with the fast checker");
  const check = await world.run("lake", ["env", "lean", FILE], { timeoutMs: 600_000 });
  clean = check.exitCode === 0 && !check.stderr.includes("sorry");
  if (clean) break;
  log(`round ${round}: checker rejected`);
  phase("Repair what the checker rejected");
  await prover.ask<Attempt>(`The checker rejected the file:\n${check.stderr}\nRepair ${FILE}.`);
}
if (!clean) return { proved: false };

phase("Build the whole project once before handing over");
const build = await world.run("lake", ["build"], { timeoutMs: 1_800_000 });
return { proved: build.exitCode === 0 };
```

The subagent does the open-ended work; the script does the judging, and that judgement cannot be delegated. `world.run` executes the checker for real, so "verified" is never a claim — only an exit code. A nonzero exit is a **value**, which is why the loop reads `check.exitCode` and feeds `check.stderr` forward instead of catching anything. Rejections are reserved for the world failing to answer (spawn failure, timeout, output over the cap), and a `try`/`catch` around the call is how a script picks a fallback for those.

Two tiers, and the difference is the whole point. The per-file checker is the fast tier: it answers in seconds, so it drives the rounds. It is not the verdict — `lake env lean` exits 0 on a proof that still says `sorry` and only warns on stderr, which is why the loop reads stderr as well. The whole-project build is the strong tier: it is what the request was about, and it runs once at the end even though the fast tier already passed. Pick both tiers by reading the repository — the README's "run this to verify" line, the `Makefile`, the `package.json` scripts — never from habit. The strongest check the repository offers for what the user asked is the one that decides (SKILL.md §5).

The command name is a compile-time literal by rule, since the user approves the script's command set at confirmation. Interpolate paths, flags and round numbers into the **args**, never into the command. Compare shape 5: the same loop, except the checker there was a subagent. Prefer this shape whenever a real command can render the verdict.

---

## 10. Per-item pipeline

**When:** two or more stages map one to one — hunter per file and confirmer per finding, migrator per file and checker per file — and nothing in the later stage needs the whole earlier stage.

```ts
phase("Hunt for bugs in each file and confirm them as they are found");
const confirmed = (
  await Promise.all(
    paths.map(async (p) => {
      const hunt = await agent(`hunter-${p}`).ask<Hunt>(`Hunt for correctness bugs in ${p}.`);
      return Promise.all(
        hunt.bugs.map(async (bug, index) => {
          const check = await agent(`confirmer-${p}-${index}`).ask<Confirmation>(
            `Reproduce this bug from its evidence alone. Do not edit any file.\n${JSON.stringify(bug)}`,
          );
          const reported = { ...bug, status: check.reproduced ? "verified" : "unconfirmed" };
          report(reported);
          return reported;
        }),
      );
    }),
  )
).flat();
```

One join, at the end, where the report needs every item. Compare the two-barrier version — `Promise.all` over the hunters, then `Promise.all` over the confirmers — which starts no confirmer until the slowest hunter finishes and leaves the concurrency slots idle meanwhile. The cache identity of a revised re-run is unaffected: each subagent is still named and asked in the same order.

One phase covers the whole pipeline, named for what it does to each item. Do not place a marker per stage inside the callback: the run has a single current phase, and concurrent callbacks re-entering two markers out of order would stamp each other's steps.

When one item failing should cost one item, catch inside the callback (examples #3) or use `Promise.allSettled` and read each outcome. A rejection inside a plain `Promise.all` takes the join and the siblings with it.
