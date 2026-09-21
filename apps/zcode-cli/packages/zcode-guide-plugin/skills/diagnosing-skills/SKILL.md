---
name: diagnosing-skills
description: Use to diagnose and fix ZCode skill configuration problems in the ZCode client. Applies when a skill is not discovered, is installed but does not trigger automatically, is shadowed by a higher-precedence skill of the same name, is disabled by configuration, has a SKILL.md frontmatter error, fails to load because its description is too long, or disappears because the plugin providing it is disabled. Provides the discovery order, how to inspect skills in the client, common pitfalls, and a step-by-step localization and repair workflow.
---

# Diagnosing Skill Configuration

The goal is to land on one concrete fix. Start by separating two things that get conflated: a skill that **loads** and a skill that **triggers**. They fail for different reasons and the fixes do not transfer.

A person looks at **Settings → Skills** and the **`/` menu** (Skills group). An agent reads the files at the locations below.

## 1. Discovery order

Scanned earliest-first:

1. Explicitly configured roots
2. User `~/.zcode/skills`
3. User `~/.agents/skills`
4. Workspace `.zcode/skills` — from the working directory up to the repository root, every level counted, deeper wins
5. Workspace `.agents/skills`
6. Enabled **plugin** roots, last

Inside one level `.zcode` is read before `.agents`. Because a skill's identity is its **file path**, same-named skills at different paths are all discovered, yet only the first in that order is loaded — everything after it is shadowed. Names starting with `.` (`.system` excepted) and `node_modules` are never scanned.

## 2. SKILL.md, and its two failure tiers

A skill is a directory holding a `SKILL.md`. Frontmatter is a `---` block of flat `key: value` lines; indented keys are ignored, and multi-line values need `>` or `|`. Recognized keys: `name`, `description`, `when_to_use`, `license`, `metadata`.

- **Dropped entirely** when frontmatter exists but `name` is absent, `description` is absent, or `description` runs past 1024 characters.
- **Loads but will not trigger** when there is no frontmatter at all: `name` falls back to the directory name and `description` comes out empty, so the model has nothing to match against. A malformed line is simply skipped.
- **Triggering** works by presenting `name`, `description` (cut to roughly 250 characters) and `when_to_use` to the model, which decides for itself. There is no keyword matcher. What makes a skill discoverable is a description that states plainly when it should be used.

## 3. Inspecting what is there

- **Client**: **Settings → Skills** lists every discovered skill with its group, including a **Plugin Skills** group. Typing **`/`** in the input box and opening the Skills group shows the same set with keyword search.
- **Agent**: walk the discovery order and read each `SKILL.md`. The copy that actually loads is the first whose frontmatter `name` — or the plugin's `plugin:skill` qualified name — matches. If that is not the file you edited, you have found the shadow.

## 4. Pitfalls, by symptom

1. **Never appears, wrong directory.** Not directly under a discovery root, or the file is not spelled `SKILL.md` (case matters on Linux). → Move it to `~/.zcode/skills/<name>/SKILL.md` or `<repo>/.zcode/skills/<name>/SKILL.md`.
2. **Never appears, dot-directory.** Something like `~/.zcode/skills/.foo/` is skipped because names starting with `.` are excluded, `.system` aside. → Drop the leading `.`.
3. **Listed but never fires.** The description is empty or too weak, and only about 250 characters of it are ever shown. → Add `description` and `when_to_use`, and put the trigger wording inside the first 250 characters.
4. **Edits do nothing, shadowed.** First same-named skill wins; user beats workspace beats plugin, and a deeper working directory beats the repository root. → Walk the order for that name, then rename or delete the copy that outranks yours.
5. **A known-good skill vanishes.** Configuration disabled it by absolute path. → In `~/.zcode/cli/config.json` or the workspace `.zcode/config.json`, set that path's `enable` to `true` or delete the override.
6. **Frontmatter misparsed.** Only top-level scalars are read; indented keys vanish and multi-line values need `>` or `|`. → Keep `name`/`description` as top-level scalars, and use `description: >` with an indented continuation for long text.
7. **Directory exists, no skill.** The file is not named exactly `SKILL.md`. → Rename it.
8. **Skill dropped, description too long.** Over 1024 characters. → Cut it below 1024 and move the detail into the body.
9. **`.agents` copy ignored.** Within a level `.zcode` is read first, so a same-named `.zcode` copy takes the slot. → Remove the `.zcode` duplicate or rename one of them.
10. **Plugin skill gone.** A disabled or suppressed plugin contributes no skill roots. → Enable it in **Settings → Plugin Management**, or take it off the suppressed-built-ins list.
11. **Invoked the wrong way.** Skills are called by `name` or `plugin:skill` — not by file path, and not with a leading `/`. → Use the exact name.
12. **Nothing at all, subsystem off.** The skill feature or `skills.enabled` is false. → Set both to `true`; both default to true.

## 5. Narrowing it down

Work down this list and stop at the first hit.

1. **Is the feature on?** Check the skill feature and `skills.enabled` in `~/.zcode/cli/config.json` and the workspace file. Either one false means no discovery at all — pitfall 12.
2. **Is it discovered?** Look at **Settings → Skills**, and read the files from the working directory the session actually runs in, since discovery is relative to it. Completely absent → pitfalls 1, 2, 5, 7, 10 or 12.
3. **Did it fail to load?** On disk but not listed usually means a frontmatter problem — missing `name`/`description`, an over-long `description`, or a malformed line: pitfalls 6 and 8.
4. **Which copy wins?** Walk the order for that name and compare the first matching `SKILL.md` with the file you edited. A mismatch is shadowing: pitfalls 4 and 9.
5. **Is it switched off?** Search both configuration files for the skill's absolute path with `enable: false`.
6. **Is it a plugin skill?** If the name is `plugin:skill`, confirm the plugin is enabled and not suppressed.
7. **Discovered but silent?** Read `description` and `when_to_use` — empty, or long enough to be truncated, is pitfall 3.
