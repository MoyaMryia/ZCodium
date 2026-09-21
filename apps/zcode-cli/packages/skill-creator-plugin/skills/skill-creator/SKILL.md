---
name: skill-creator
description: Create new skills, edit existing skills, and iterate wording. Use when writing SKILL.md from scratch, improving existing skills, turning repeated workflows into reusable skills, or refining skill descriptions to improve trigger reliability.
---

# Skill Creator

A skill for authoring and iteratively improving local ZCode skills.

The loop, in outline:

- Decide what the skill should do and roughly how
- Write a draft
- Run it against 2–3 realistic test prompts
- Read the results with the user and revise
- Repeat until it's good enough

When this skill loads, your first job is to work out where the user already is in that loop and help them move forward. "I want a skill for X" means start at the top; a draft in hand means jump to evaluation. Follow their lead — if they say "just vibe with me, no formal evaluation," do exactly that.

## Talking to the user

Skill authors here range from people who have written dozens to people writing their first. Watch for context cues. When unsure, define the term inline ("an *eval prompt* is just a test message you send the model to see how the skill behaves") instead of assuming it's known.

---

## Creating a skill

### Capture intent

Work out what the user actually wants before writing anything. If the current conversation already contains a workflow worth capturing — they've done the same thing manually three times and now say "turn this into a skill" — mine the history first: which tools, in what order, what corrections they made, what the inputs and outputs looked like. Fill remaining gaps by asking.

Questions worth asking:

1. What should this skill let the model do?
2. When should it fire? Which phrasings or situations?
3. What shape should the output take?
4. Are there example inputs/outputs that pin the behavior down?

### Where skills live

ZCode discovers skills here, highest priority first:

- `<project>/.zcode/skills/<name>/SKILL.md`
- `<project>/.agents/skills/<name>/SKILL.md`
- `~/.zcode/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

**Put new skills under `.agents/skills/`** — it's the standard, cross-tool location. Keep in mind that `.zcode/skills` still wins during discovery: when the same name exists in both, the `.zcode/skills` copy is the one used, which makes `.zcode/skills` the place to *override* a skill. Use the `<project>` path for skills that only make sense in this repo, and `~/` for personal ones you want everywhere.

### Write the SKILL.md

A skill is a directory holding a `SKILL.md` — YAML frontmatter plus a markdown body:

```text
my-skill/
├── SKILL.md          (required)
└── (optional)
    ├── references/   (extra docs the model reads on demand)
    ├── scripts/      (helper scripts the model can invoke)
    └── assets/       (templates, fixtures, etc.)
```

Two frontmatter fields are required:

- `name` — the skill's identifier. Lowercase kebab-case, 1–64 chars, and it must match the directory name.
- `description` — when to trigger and what it does. This is the main triggering signal, so both the *what* and the *when* belong here rather than in the body. Models under-trigger skills, so lean pushy: not "How to build a dashboard for internal data," but "How to build a fast dashboard for internal data. Use whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any company data — even if they don't explicitly say 'dashboard'."

The ZCode skill spec lists the reserved optional fields; `name` and `description` are enough for most skills.

### Progressive disclosure

Skills load in three layers:

1. **Metadata** (name + description) is always in context. Keep it tight.
2. **SKILL.md body** loads only once the skill triggers. Aim for under 500 lines.
3. **Bundled files** (`references/`, `scripts/`, `assets/`) load on demand, with no practical size limit.

When the body starts running long, move domain detail into reference files and tell the model in SKILL.md when to reach for each one:

```text
cloud-deploy/
├── SKILL.md            (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

SKILL.md then carries a line like "if the target is AWS, read references/aws.md before proceeding."

### Writing style

Use the imperative ("Read the file before editing"). When a rule isn't self-evident, say *why* it exists — current models follow guidance far better when they have the reason. If you notice yourself stacking all-caps MUSTs and NEVERs, that's a signal the rule needs explaining rather than shouting.

A concrete example beats an abstract rule. If the skill emits structured output, include a literal sample of that format. If a particular tool should be used, show the call.

### Test prompts

Once a draft exists, write 2–3 test prompts that look like real requests — concrete paths, real column names, casual wording, the odd typo. Show them to the user first: "Here are the cases I want to try. Anything to add or change?"

Then run them: load the draft skill, hand it the prompt, and watch what happens. ZCode doesn't spawn parallel evaluation subagents today, so run one prompt at a time and go through each result with the user.

---

## Reviewing the draft

For every test prompt:

1. Confirm the draft sits where ZCode can discover it (one of the paths above).
2. In a fresh turn, give the prompt to the model. Let the description trigger the skill, or force it with `/skill <name> <prompt>`.
3. Go through the result *with the user*. Did it trigger? Was the output what they wanted? Where did it drift?

Look at the result *and* the trace. If the skill sent the model into busywork — re-reading the same files, writing a throwaway script, circling — it's probably over-prescribing or ambiguous. That's a reason to cut, not to add rules.

---

## Improving the skill

This is where the loop earns its name. You have test results and user feedback; now make the skill better.

Four things to weigh:

1. **Generalize from the feedback.** A handful of examples is enough to iterate quickly, but the skill has to work on inputs neither of you has seen. When a stubborn problem won't yield to targeted edits, change the framing rather than piling on constraints. Overfit rules and oppressive MUSTs degrade a skill over time.

2. **Keep it lean.** Delete anything that isn't earning its place. If the model burns tokens on busywork the skill invited, remove the guidance that invited it and see what happens.

3. **Explain the why.** Models reason well when given context. Even when feedback is terse or irritated, work out what's actually being asked for and put that understanding into the instructions. Reframing usually beats enforcement.

4. **Watch for repeated work.** If every run independently wrote the same helper script or took the same multi-step route, move it under `scripts/` and point the skill at it. Write it once instead of making the model reinvent it each time.

Then cycle:

1. Apply the changes.
2. Rerun the test prompts.
3. Show the user the new outputs.
4. Continue until they're satisfied, or further edits stop helping.

---

## Updating an existing skill

When the goal is to update an installed skill rather than create one:

- Keep the original `name` and directory name. An installed `research-helper` stays `research-helper` — not `research-helper-v2`.
- If the installed path is read-only (for example inside an official plugin cache), copy the skill somewhere writable such as `~/.agents/skills/<name>/`, edit it there, and let user-priority discovery shadow the original.
- Same-name skills at different paths remain separate installed skills; the path is the installation identity.

---

## The core loop, once more

- Work out what the skill is for.
- Draft it.
- Run 2–3 realistic test prompts.
- Read the results with the user.
- Improve.
- Repeat until they're happy or improvements stop landing.

Good luck.
