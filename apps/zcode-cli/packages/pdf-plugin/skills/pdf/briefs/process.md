# Brief — Process documents

Applies to the procedural family: runbooks, SOPs, how-to guides, installation
and migration manuals, incident playbooks, internal specifications. The reader
is executing, not browsing — they arrived from a search result or a pager alert
and need one exact step.

## Structure for execution

- **Numbered steps, always.** A procedure is a sequence a reader can hold a
  finger against. Sub-steps use decimal numbering (4.2), never bullets that
  imply a set when the content is an order.
- **One action per step.** "Install the package and configure the service and
  restart it" is three steps and three failure points.
- **Preconditions before step 1**: required access, required state, required
  tools — stated as a checklist, not woven into the prose.
- **Verification after the last step**: how the reader knows it worked. A
  procedure without a success signal generates the support ticket it was
  written to prevent.

## Page and type furniture

- Body 10–11 pt with generous leading (1.4+): these documents are read on
  screen, often at 100%, often in a hurry.
- Step numbers in the margin or in a bold run-in; code blocks in a monospace
  face at a size that survives copy-paste.
- Running heads carry the section name — the reader who lands mid-document
  needs to know where they are.
- Tables of contents and page numbers matter: this is the family that gets
  printed and pinned to a wall.

## Code, commands and parameters

- Every command is copy-pasteable and complete: no `...` elisions inside a
  command, no placeholders without a stated format (`<HOSTNAME>` explained
  where it first appears).
- Show the expected output when the output is the verification, and mark the
  lines the reader should check.
- Parameter tables: name, type, required/optional, default, effect. One row per
  parameter, sorted the way the reader will look them up.
- Platform differences are explicit branches ("On Windows: ...", "On macOS:
  ...") — never a parenthetical the reader has to decode.

## Warnings and edges

- Destructive or irreversible steps get a warning immediately before the step,
  naming the consequence and the rollback.
- Rollback is a first-class section: how to undo, and how to tell the undo
  worked.
- Failure modes that actually happen get their own short section ("If the
  service fails to start, check X first") — placed where the reader is when it
  happens, not in an appendix.

## Versioning and maintenance

- State the software versions the procedure was written against, at the top.
- Date the document and name the owner; a runbook nobody owns rots silently.
- When a step changes, change the step — never append "update: as of March,
  ..." below it. Contradicting instructions in one document is worse than an
  outdated one.

## Pitfalls

- Screenshots of CLI output: they cannot be copied and they age badly. Use text
  blocks; reserve images for UI locations that words cannot place.
- "Simply", "just", "obviously" — a reader who is stuck does not find these
  reassuring. State the step.
- Long prose paragraphs between numbered steps: the reader loses their place.
  Prose belongs in the *why* note after a step group, not inside the sequence.
