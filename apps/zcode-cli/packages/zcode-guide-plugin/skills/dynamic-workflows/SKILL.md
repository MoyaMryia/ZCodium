---
name: dynamic-workflows
description: Use when writing, debugging, or revising a dynamic-workflow script for the CreateWorkflow tool. Covers when an explicit workflow request makes CreateWorkflow mandatory, subagent topology and naming, typed ask results, journaled world reads and world.run gates, rehearsing fixed logic with EvalWorkflowSnippet, phases, report and artifact delivery, and revising a submitted run with AmendWorkflow.
when_to_use: "Only for CreateWorkflow scripts. A single delegation or a few independent lookups belong to the Agent tool instead."
---

# Writing dynamic workflows

`CreateWorkflow`'s tool description carries the whole facade — every declaration your script is compiled against, generated from the same source as the compiler — plus the authoring rules it enforces. That is where the API surface is read. What lives here is the layer above: how much orchestration a request justifies, which subagents ought to share a context, what each one hands back, and how the run's work outlives the run.

One naming note: this skill is about `CreateWorkflow` only. `/expert` is a separate built-in channel for the legacy script workflow; the shared word is all they have in common.

## 1. When a workflow starts

| The request                                                | The tool                    |
| ---------------------------------------------------------- | --------------------------- |
| One thing delegated to one agent                           | `Agent`                     |
| A few independent lookups, nobody reading anybody's answer | `Agent`, in parallel        |
| Anything else the user did not name a workflow for         | `Agent`, or do it yourself  |
| The user named workflow/工作流 as the means — any phrasing | `CreateWorkflow`, mandatory |

**A workflow starts only on an explicit request.** It begins with `/workflow`, or with the user naming workflow/工作流 as the means — never with your own assessment that a task looks orchestration-shaped. Results feeding later steps, a loop with a stopping condition, control flow branching on a typed result: none of these, alone or together, justify starting one.

**An explicit request is binding.** Once the user has chosen the tool, routing is settled — not `Agent`, not inline, not "too small for a workflow". Your remaining decision is how large the script should be, and even the smallest task gets a small workflow. Asking for a workflow is asking for expert-standard work: enough subagents to cover the ground properly, fresh eyes on each plan and draft, deterministic checks wherever a command can settle the question, and a report that separates what was verified from what was not.

## 2. What the compiler accepts

Plain TypeScript, compiled inside an async function body under `strict` with `noUncheckedIndexedAccess` deliberately off:

- Define result types with a plain `interface` or `type` and pass them as `ask<T>` arguments. Indexing (`items[i]`) needs no guard; `.find()`, `.match()`, `Map.get()` and optional properties still yield `T | undefined` and must be guarded.
- No `import`, no `export`, no `declare` — the facade's own declarations use `declare` because they describe the host's ambient API; do not imitate them.
- No Node or web APIs. The script sees ES2022 plus the facade and nothing else, so `process`, `fetch` and `fs` fail typechecking.
- Top-level `await` and a final `return <value>` are allowed; the returned value is exactly what arrives in the completion notification.

Three ways to give the tool a workflow, exactly one per call: `script` inline (saved to `.zcode/workflow-drafts/` before it is even compiled, and the result names the file either way), `path` to a file on disk, or `saved` for a workflow already saved in this project under `.zcode/workflows/` (check `ListSavedWorkflows` first — a saved workflow the user already reviewed beats rebuilding one). An inline script exists to be edited and resubmitted by `path`; never paste a whole script a second time.

## 3. Subagent topology

Each `agent()` call opens a new context. Sharing means sharing the _variable_:

```ts
// Independent: one actor per file, and no migrator waits on another.
const moved = await Promise.all(
  paths.map((p) => agent(`migrator-${p}`).ask<Migration>(`Migrate ${p} to the new API.`)),
);

// Calibrated: a single context reads every file, so its verdicts share one
// scale. Its asks run one at a time, in the order they were issued.
const judge = agent("migrability-judge", "You rank migration difficulty on one fixed scale.");
const ranked = [];
for (const p of paths) ranked.push(await judge.ask<Score>(`Score ${p}.`));
```

Independent fits unrelated items you want running at once. Shared fits answers that must agree with each other, and the serialization is what that agreement costs. Hoisting an `agent()` call out of a fan-out because it looks tidier converts a parallel fan-out into a queue; nothing rejects the script, the run just takes as long as every item in sequence.

**A name is an identity, and a non-empty one must be unique in the run.** A duplicate fails the entire run at the second `agent()` call. A literal duplicate is caught before submission; a name assembled at runtime is invisible to the compiler and costs you the run — which is why a fan-out needs per-item names or none at all. Give names anyway: a revised re-run matches its cache per named subagent (§10), so stable, meaningful names carry finished work across script revisions at zero token cost. Anonymous subagents are legal and always start from an empty context.

**Persona, frozen at creation.** The persona sits on top of the harness's own subagent contract — ground every claim in something read or run and cite it as `path:line`, never fake a passing result, escalate rather than improvise when blocked. Write the role and the standard of judgement; those rules are already there. Every subagent has the same working tools (reading, searching, editing, running commands) and runs on the session model — there is no per-subagent tool or model choice, so what a subagent may do belongs in the ask: a reviewer that must not touch the code is told "do not edit any file". None of it can change after `agent()`.

**Loops.** Cap every loop by rounds and carry the feedback forward:

```ts
let feedback = "none";
for (let round = 0; round < 5; round++) {
  const plan = await migrator.ask<Plan>(`Migrate one call site. Previous review: ${feedback}`);
  const review = await reviewer.ask<Review>(`What breaks this migration? ${JSON.stringify(plan)}`);
  if (review.approved) break;
  feedback = review.findings;
}
```

Reuse the same two subagents across rounds; that is the point. A subagent asked more than once keeps its accumulated context, which makes round five cheap, while a fresh planner each round re-learns everything round four taught it. The price of reuse is freshness: keep the persistent reviewer for continuity and add an independent one at the end.

**No nesting.** Subagents cannot orchestrate. `CreateWorkflow`, `AmendWorkflow`, `SaveWorkflow`, `ResumeWorkflowRun` and `ResolveWorkflowQuestion` are structurally unregistered inside a workflow child, so a task large enough to want its own workflow becomes more subagents here.

## 4. Typed results

Give `ask` a type argument whenever control flow branches on the answer, and leave it off when you only want prose back. The type must be an interface or type alias written in the script.

**JSDoc on a property becomes the field description the subagent actually reads** — the harness synthesizes the result schema from the type, and the comment becomes the JSON Schema `description`. It is the cheapest quality lever on the surface and the one most often skipped:

```ts
interface Migration {
  /** Workspace-relative path of the migrated file. */
  path: string;
  /** Call sites changed, as "file:line" entries. */
  callSites: string[];
  /** "clean" when the file typechecks after the change; "blocked" with reason when it cannot. */
  outcome: "clean" | "blocked";
  /** Why the file could not be migrated, when outcome is "blocked". */
  blockedReason?: string;
}
```

Drop the comments and you inherit whatever the subagent guessed `outcome` meant. Constraint tags (`@minimum`, `@maxLength`, `@pattern`, …) land as schema constraints too.

Keep each result small. A result crosses a schema boundary and is interpolated into the next prompt, so a wide one is paid for twice. **Pass paths, not file contents** — a subagent has its own file tools and reads what it needs; a stringified 4000-line file spends tokens describing something it could have fetched itself.

## 5. Getting the world in

`files.glob`, `files.read`, `files.grep`, `git.changedFiles`, `git.diff`, `git.status`, `git.log` and `world.run` are the only window onto the workspace. The harness executes them, records them in the journal, and replays them from the record on resume, so a resumed run sees the repository as it was.

Caps **reject the call instead of trimming its result**: `files.glob` stops at 2000 files, `files.grep` at 2000 matches or 256KB, `git.diff` at 512KB, `git.log` at 100 commits. An over-wide `files.grep` errors out rather than handing you a silently partial workspace — narrow the pattern or add a glob filter. A read that overshoots a cap, and any `git` call made outside a repository, both arrive as catchable rejections — so a read the script leans on is written with its fallback beside it:

```ts
let hits: GrepMatch[];
try {
  hits = await files.grep("CreateWorkflow", "**/*.ts");
} catch {
  hits = await files.grep("CreateWorkflow", "packages/**/*.ts");
}
```

Use `files.read` or `files.grep` only when the _script itself_ must shard or branch on content. Choosing which files to hand out is script work; reading them is subagent work.

**`world.run` is the deterministic gate.** When a check is fixed and machine-checkable, run it as code and branch on the exit code instead of asking a subagent to run it and trusting the claim:

```ts
const check = await world.run("pnpm", ["typecheck"], { timeoutMs: 1_800_000 });
if (check.exitCode !== 0) feedback = check.stderr;
```

A nonzero exit code is a **value**, not an exception — the gating loop's normal case reads `exitCode` and carries `stderr` into the next round with no `catch` anywhere. Rejections are kept for the world failing to answer: spawn failure, timeout (300s by default, overridable per call, no cap), or output past the per-stream cap of 256KB. The command name must be a compile-time string literal, because the user approves the script's command set at confirmation — interpolate paths, flags and round numbers into the **args array**, never into the command. It is fixed argv, never a shell: no pipes, no redirection, no variable expansion. Keep the division of labour too: open-ended editing belongs to a subagent with tools, while `world.run` is for checks your control flow branches on.

**Choose the gate before writing it.** Before the first `world.run`, find out what checks the repository actually has — the scripts in `package.json`, a `Makefile`, the CI config, the README's verify line — and rank them by how much they decide. A unit suite decides less than an end-to-end suite, which decides less than the acceptance command the README names. Build the gate in two tiers: a fast tier may drive a loop's rounds, and the strongest tier the request calls for runs for real at least once before the final `return`, with the `timeoutMs` it needs. A check the repository has that did not run is not "not covered"; it is unverified work.

## 6. Rehearse the pieces before you commit

Once submitted, a workflow script is frozen. The fixed logic inside it does not have to wait for that: run it through `EvalWorkflowSnippet` first, which compiles and executes a snippet against the same compiler, sandbox and world-read path a real run uses, synchronously, persisting nothing. What passes there pastes into the workflow unchanged. Send the snippet as `code`, or as `path` to a file holding it once you have written it out — the second attempt then costs an `Edit` instead of the whole snippet again.

Snippet work is precisely the non-subagent part: what a glob really returns (workspace-relative, sorted), whether a grep pattern overruns its cap, how a command's stderr parses, whether a gate predicate does what you intended. A snippet has `files.*`, `git.*`, `world.run` and `log` but no `agent()` — orchestration cannot be rehearsed, only its pieces. Burning a full run to test a parse function is the expensive way to find a typo. Once you know which check decides the result (§5), run it here too: that shows you its output shape, whether it exits nonzero the way you assumed, and how long it takes — which is the `timeoutMs` you write, rather than a guess.

## 7. Keep the script analyzable, and join only where the data needs everyone

The harness reconstructs the dependency graph by reading your code ahead of execution — the same reading produces the confirmation graph the user approves and the cache matching an amendment relies on — so write code whose data flow can be seen. Node results moving through plain variables, template interpolation, destructuring and small local helpers are traced exactly. A facade callable that escapes into value space (`const g = files.glob`) has no site the graph can represent and is rejected at analysis time.

`Promise.all` joins, and a join blocks: nothing after it begins until the slowest item before it has arrived. Parallelism comes from _not awaiting yet_:

```ts
// Concurrent: nothing is awaited until the join.
const all = await Promise.all(
  paths.map((p) => agent(`migrator-${p}`).ask<Migration>(`Migrate ${p}`)),
);

// Serial: every await holds up the one after it — reach for this deliberately.
for (const p of paths) results.push(await agent(`migrator-${p}`).ask<Migration>(`Migrate ${p}`));
```

**Join where the next step needs every item, and nowhere else.** When two stages map one to one — a migrator per file and a checker per file — a barrier between them makes every checker wait on the slowest migrator while concurrency slots sit idle. Chain the stages per item inside the fan-out and join once at the end:

```ts
// ✗ Two barriers: no file is checked until every file has been migrated.
const migrations = await Promise.all(
  paths.map((p) => agent(`migrator-${p}`).ask<Migration>(`Migrate ${p}`)),
);
const checked = await Promise.all(
  migrations.map((m) => agent(`checker-${m.path}`).ask<Check>(`Check ${m.path}`)),
);

// ✓ One join: each file is checked the moment its migration lands.
const checked = (
  await Promise.all(
    paths.map(async (p) => {
      const migration = await agent(`migrator-${p}`).ask<Migration>(`Migrate ${p}`);
      return agent(`checker-${p}`).ask<Check>(`Check ${p}: ${JSON.stringify(migration)}`);
    }),
  )
).flat();
```

The stages that genuinely need everyone — a ranking on one scale, a synthesis deduplicating across results — are the legitimate barriers, and they are few. A shared, calibrated subagent is not one of them: asks on it queue FIFO, so feeding it per item as results arrive keeps it consistent _and_ keeps the pipeline moving (§3).

A single rejection inside `Promise.all` rejects the whole join along with its siblings. If one bad item should cost only itself, catch inside the callback or use `Promise.allSettled` and read each outcome.

## 8. Group the run into named phases

Phases are mandatory. The user experiences a workflow through its phase graph: the confirmation dialog they approve is drawn one node per phase, and a dialog holding thirty step cards is a dialog nobody reads. Cover the whole script — every stage gets a `phase("...")` marker at its head, and the arrows between phases come from the same analysis.

```ts
phase("Migrate every call site of the renamed function");
const paths = await files.glob("src/**/*.ts");
const migrations = await Promise.all(
  paths.map((p) => agent(`migrator-${p}`).ask<Migration>(`Migrate ${p} to the new name.`)),
);

phase("Confirm the whole workspace still typechecks");
const check = await world.run("pnpm", ["typecheck"], { timeoutMs: 1_800_000 });

phase("Run the test suite once before handing over");
const tests = await world.run("pnpm", ["test"], { timeoutMs: 1_800_000 });
```

Five nodes stay five once the real script reaches thirty steps. That is the payoff: the user sees the story you had in mind instead of a wall of cards.

- **Write the names for the user, in the language they are speaking this session.** A phase name is a short natural phrase saying what this stage achieves — "Migrate every call site", "确认测试仍然通过". Orchestration vocabulary the user never chose ("fan-out", "gate", "aggregate") names the machinery rather than the work. Names must be compile-time string literals, so rounds cannot be numbered by interpolation — nor should they be: two markers sharing a name are one node, which is how a loop body stays a single box across all its rounds.
- **Put the marker where the steps are.** A marker takes over the remainder of the block it sits in, nested blocks and inlined helper calls included, so a marker inside an `if` covers that branch and stops at its closing brace.
- **Not inside a concurrent fan-out callback.** The run has one current phase and every step is stamped with it at birth; twenty `map(async …)` callbacks re-entering `phase(...)` out of order would stamp each other's steps. A per-item pipeline is one phase, named for what it does to each item, with the markers at the top level around it.
- **Every phase must contain at least one `ask` or one `world.run`.** Plain script logic — reading `args`, shaping a prompt, building the `return` — runs in a flash and shows no progress, so it is not a stage. Never open a phase for the setup at the top or the `return` at the bottom.

## 9. Verify, report, deliver

`log(...)` narrates for the human watching the run. Use it where a reader would otherwise wonder whether anything is happening — after a fan-out is sized, at the top of each loop round.

**Verify before reporting, in proportion to what a wrong claim costs.** Verification exists to buy down the cost of the user acting on something false, so it belongs where that cost is real: a bug they will fix, a security claim, a number they will quote. Each such finding is confirmed independently before it reaches them — a second subagent reproducing it from its evidence alone, reading the code, running a check when one decides it, never editing — or a `world.run` command when one can decide. The reviewer that found the problem does not confirm it. A finding that fails confirmation is **kept and labelled** `unconfirmed`, never silently dropped.

Three things resemble verification and are waste: a confirmer on a finding a `world.run` already decided (the exit code is the confirmation), a confirmer on work nobody will treat as fact, and a suite run three times because the hunter ran it, the confirmer ran it, and the script then gated on it — a check the script gates on runs once, by the script, and the asks say so.

**Gate at the scale of the task.** `verified` names the commands that actually decided the result; a unit suite in `verified` with the end-to-end suite skipped is not a verified deliverable. `notCovered` is for what _could not_ be checked — no test exists, the environment lacks the tool — never for a check the repository has that was skipped because it was slow.

**Salvage by report.** `report(...)` differs from `log` and matters more: reported items arrive with the completion notification **even when the run fails**. A forty-task run that dies on task twelve still did eleven tasks' worth of work, and `report` is the only thing that gets it out. Report each finding as it lands — after its confirmation, with its status — instead of accumulating an array and returning it at the end, because the array is what you lose. Items are journaled, so a resumed run never shows the same one twice. Caps: 256 items per run, 32KB per serialized item, and the item must be JSON-serializable.

**Deliver a report.** The script's final `return` is the handoff the main agent presents. Return this shape — copy the interfaces, they compile as-is — rather than a bare array:

```ts
interface Finding {
  /** Workspace-relative path, with ":line" appended when the finding sits on one. */
  where: string;
  /** One sentence: the defect, or what the run turned up. */
  what: string;
  /** The proof — lines that were read, or the command plus the output that settled it. */
  evidence: string;
  /** "verified" only once a second subagent or a deterministic check reproduced it. */
  status: "verified" | "unconfirmed";
  /** Impact of the finding: "high" means lost data, a crash, or an answer that is wrong. */
  severity: "low" | "medium" | "high";
}
interface WorkflowReport {
  /** Two or three sentences that answer what the user asked for. */
  conclusion: string;
  findings: Finding[];
  /** What the run actually checked, and by which command or file read. */
  verified: string[];
  /** What the run could not examine, and the reason it could not. */
  notCovered: string[];
}
```

Give it an independent read before returning: a reader-proxy subagent that has seen nothing else tells you what is unclear, unsupported or missing while there is still time to fix it. Write all four fields in the language the user is speaking this session.

**Deliver artifacts.** The `return` is read by the main agent, which retells it; `artifact.*` is the second channel — things the _user_ opens, shown as cards beside the run while it is still going and kept after it ends. Two families, deliberately asymmetric:

- **Content (`file`, `markdown`) are effects**: async, resolve to an `ArtifactRef`, and reject catchably — the file is missing, the path escaped the workspace, the bytes are over the cap. The honest response to a rejection is to hand the gap back to a subagent and publish again. Bytes are copied at publish time, so republishing an id mints the next version and keeps the old ones.
- **Preset (`chart`, `table`, `metrics`, `board`) are declarations**: synchronous, return nothing, and say how items tagged with their id are drawn. Declare each once at the top, then feed it with `report(item, "perf")` — one `report` call feeds both the dashboard and the run's progressive results.

Every run publishes its deliverable: the thing the user asked for via `artifact.file`, or the long form of the facts the `return` summarises via `artifact.markdown`. When the run publishes more than one artifact, mark the deliverable `{ primary: true }` — at most one id per run. Skip it only when the whole answer is one line. Ids and report tags are compile-time string literals (`[A-Za-z0-9_.-]`, at most 64 characters), so what a run can publish is fixed the moment the user approves the script. Caps: 32 ids per run, 16 versions per id, 20 MiB per file, 256 KB per markdown.

## 10. After you submit

Compilation comes first. **Diagnostics mean nothing ran** — there is no half-started run to clean up — and they name the file your script lives in, in `path:L<line>:C<column> {message}` form, counted in the file. **Edit that file, then resubmit with `path`.** Re-streaming twenty thousand tokens to change one line is slow enough that some providers stall on it, while the `Edit` costs a few lines.

On a clean compile the user confirms, then the run starts in the background and you receive a run ID. **Do not poll it.** The completion notification arrives on its own, carrying the final return value and every reported item. Go do other work unless the user asked you to wait. When you genuinely need to look: `TaskOutput` blocks until a run _this session started_ finishes; `GetWorkflowRun` is an instant snapshot that never waits and works for any session's run; `ListWorkflowRuns` enumerates the project's runs.

Read the terminal state precisely:

- **completed** — the script returned.
- **errored** — the script itself failed (an uncaught throw, a cap it overran, an artifact whose source file was missing). Replaying it would fail identically; amend it instead.
- **stopped** — resumable as-is with `ResumeWorkflowRun`, once you have read the stop reason: `user` (leave it alone unless the user asks), `model` (your own `TaskStop`), `interrupted` (the owning process exited — resume it), `provider` (a deterministic model-side error such as an expired sign-in, a model missing from the plan or a quota cap; the error block names the cause and the fix — resolve it with the user, then resume). A fifth reason, `superseded`, marks a run you amended away: read the successor instead.

Reported items come back on errored and stopped runs as well, so a dead run is still worth reading. Model errors never reach the script: rate limits, overload, network errors, timeouts and unknown provider errors are retried inside the run without limit while the fan-out adapts to what the provider accepts — so do not write retry loops or `try`/`catch` for provider errors. Reserve them for logic failures: a subagent result that failed validation, a gate that did not pass, a world read over its cap, an artifact publish whose source file is missing, or a `ContextLimit`. If nothing succeeds for twenty minutes you get one informational stall notification; the run is still going and needs nothing from you.

**When the script itself was wrong, do not start over.** Any run — errored, stopped, completed or still running — can be revised: edit the run's script file and call `AmendWorkflow` with `run_id` and that `path`. It stops a running predecessor for you, imports every finished result you left untouched at zero token cost — matched per named subagent along its sequence of asks — and starts without another confirmation when the run is this session's own. One deliberate limit: the moment any subagent runs live, the workspace may no longer be the one the old results were computed against, so from that point every `world.run`, every world read and every ask runs live even if its text is unchanged. A gate command therefore always tests the code the amended run actually produced.

That cascade rule has a converse that decides whether revisions are cheap or ruinous. Interpolating an upstream **result** into a prompt is safe: on resume that result replays byte-identical, and so does the prompt. Interpolating a script **constant** is the opposite bet — constants are exactly what an amendment tunes, and every ask whose text mentions one forfeits its cache when you tune it:

```ts
// ✗ The knob rides in the text: retuning MAX_ATTEMPTS forfeits every ask that
//   names it, and the loop re-pays for all of them.
fix = await fixer.ask<Fix>(
  `Attempt ${attempt} of ${MAX_ATTEMPTS}; the gate failed: ${check.stderr}`,
);

// ✓ The bound lives in the loop header; the text carries only replayed values,
//   so moving it shifts where the loop stops and nothing else.
fix = await fixer.ask<Fix>(`The gate failed: ${check.stderr}. Repair what it reports.`);
```

Keep the tunable knobs — thresholds, round caps — in the script's control flow, where amending them is free, and out of ask text, where amending them purges the cache. A `path` whose bytes still equal what the run already ran is refused as `script_unchanged` — that refusal means your `Edit` did not land.

## 11. When a subagent escalates

Every subagent can escalate a blocking question to you mid-run. Nothing in the script switches it on and no persona field controls it. It exists for the one thing a script cannot design around: a subagent walled in by something that is not its fault — a gate it cannot pass, two instructions no single output can satisfy, a fact only whoever started the run knows. With no way to ask, a walled-in subagent has two moves left and both are bad: grind until the round cap, or fake its way through.

A notification arrives mid-run carrying the run, the subagent, the question and a globally unique id shaped like `dwfq-...`. Only the subagent that asked is parked, and only on that one call: its siblings, the control flow and the run's status carry on. Nothing times out on its behalf. Then decide which of two things is true:

- The question **has an answer** — answer it with `ResolveWorkflowQuestion` and that `question_id`. Your text becomes the result of that subagent's own call, verbatim. Not sure? Read the run with `GetWorkflowRun`, or put the question to the user with `AskUserQuestion` — then return and answer, because nothing answers in your place.
- The **script** is what is broken — a gate no output can pass, control flow sending work to the wrong subagent. No sentence fixes that: edit the script file and call `AmendWorkflow` with that `path` (§10). The escalation is what makes that amendment cheap — the ask that escalated never settled, so it sits just past the cache boundary.

If the notification never arrives, the question is still discoverable: `GetWorkflowRun` lists whatever a run still owes an answer to under `pendingQuestions`, ids included. Each ask gets three escalations; the fourth returns as an ordinary result telling the subagent its allowance is spent — a guard against chatter, not an allowance to spend.

**Write personas that make honesty the cheap move.** A persona that says only "make the check pass" leaves faking a pass as the obedient reading. One sentence closes that off: _"If a check is impossible to pass, or your instructions contradict each other, escalate and say so plainly rather than working around it."_

## 12. Anti-patterns

| What you wrote                                                                | What it costs you                                                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hoisted one subagent out of a fan-out for tidiness                            | The fan-out silently became a FIFO queue                                                                          |
| Gave every subagent in a fan-out the same fixed name                          | A literal one is rejected before submission; a computed one kills the run at the second item                      |
| A fresh subagent each loop round                                              | Round five re-learns everything round four knew, at full price                                                    |
| Accumulated findings in an array, returned at the end                         | A failure on the last task loses all of them; `report` as you go                                                  |
| Interpolated a whole file into the prompt                                     | Paid tokens to tell a subagent something its own tools would have read                                            |
| A wide `files.grep` with no glob                                              | The call rejects; it does not quietly hand you a partial workspace                                                |
| An unbounded `while`                                                          | The harness enforces no node limit, so the loop ends only when the user cancels                                   |
| Asked a subagent to run the tests and report whether they passed              | Paid a session for what `world.run` does as code — and trusted a pass/fail claim the subagent can fake            |
| Built the `world.run` command name from a variable or template hole           | Compile fails: the user approves the script's command set, so the command must be a literal                       |
| Submitted a workflow to find out whether a parse function works               | A full run spent on what `EvalWorkflowSnippet` answers synchronously                                              |
| `process`, `fetch`, `fs`, `import`                                            | The script sees ES2022 plus the facade and nothing else — no ambient Node or web types — so all fail typechecking |
| Dereferenced a `.find()` / `.match()` result without a guard                  | Compile fails: `strict` keeps those `T \| undefined` / `null`; plain `items[i]` needs no guard                    |
| Awaited each call in a loop that had no ordering requirement                  | Serial wall-clock for concurrent work                                                                             |
| Interpolated a tunable constant into an ask message                           | Amending that one number rewrites every prompt that mentions it and re-pays everything downstream                 |
| Named a phase or a subagent after the machinery, or shipped no markers at all | The user approves a graph whose stages say nothing about their work — or thirty cards with no story               |
| Reported findings nobody confirmed                                            | The user gets a list that cannot tell "seen" from "suspected"                                                     |
| Gated the loop on the fast check and never ran the strongest one              | The work passed the check that was cheap, not the one that decides                                                |
| Put a check that exists into `notCovered` because it was slow                 | An honest-looking report of unverified work                                                                       |
| Returned a bare array as the run's result                                     | The main agent improvises the deliverable, so the user gets a different shape every time                          |
| Returned the report and published nothing                                     | The user gets the main agent's retelling and nothing to keep                                                      |
| Published a CSV and a table of its rows                                       | Two cards for one fact: the second is noise                                                                       |
| Declared a dashboard for a run nobody watches                                 | A dashboard is for the person watching the run                                                                    |
| Waited for a run you already knew was wrong to finish                         | Everything after the fix point is re-paid either way; call `AmendWorkflow` on it now, while it runs               |

## 13. Going deeper

- `${ZCODE_SKILL_DIR}/patterns.md` — the topology catalogue: fan-out/fan-in, review sweeps, planner–reviewer loops, judge panels, staged pipelines, bounded discovery, verifier loops. Read it once you know which shape you want and want it written correctly.
- `${ZCODE_SKILL_DIR}/examples.md` — complete worked scripts. Read one when you want to follow a whole script's arc.
