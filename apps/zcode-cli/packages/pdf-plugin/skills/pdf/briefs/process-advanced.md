# Brief — Process documents, advanced

The advanced companion to `process.md`, for documents that are larger than one
procedure: multi-part manuals, generated API references, migration runbooks
with decision trees, documents that must be rebuilt from source on every
release. Read `process.md` first; this brief assumes its rules hold and adds
what scale changes.

## Multi-part structure

- **Part → chapter → procedure** hierarchy, decided before writing. A reader
  should be able to say what part a page belongs to from the running head alone.
- One procedure per page region, with its own preconditions and verification —
  a chapter is a container, not a unit of execution.
- Cross-references are explicit and stable: "see §7.3 Restore from backup", not
  "see the backup section". `\ref`/`\autoref` or the generator's own link
  mechanism, never hand-written numbers.
- A document map (one page, the whole structure with page numbers) at the front
  for anything over ~20 pages. Print readers navigate by it.

## Generated content

- **API references and CLI manuals are generated, not written.** The source of
  truth is the code; the document is a build artifact with the build command
  recorded (`--help` output, an OpenAPI schema, a schema-doc tool). Hand-written
  API pages drift on the first release.
- Generated and hand-written parts live in clearly separated directories so a
  rebuild never overwrites prose.
- The generated output still gets an editorial pass: option grouping, examples,
  and the "start here" page are written by hand around the generated core.
- Record the generator version in the document; a rebuild with a newer
  generator is a change to review.

## Decision trees and branching procedures

- When the path depends on state, express it as a decision table or a flowchart
  figure — not as nested conditionals in prose ("if A then ... otherwise, if B
  but not C, ..." is where readers give up).
- Every branch terminates in a procedure or an explicit escalation. No dead
  ends, no "contact support" without the escalation's own section.
- TikZ or Graphviz for the diagram; the figure carries the shape, the numbered
  procedures carry the detail, and the figure references the procedure numbers.

## Diagrams inside a LaTeX build

- Diagrams are source, not screenshots: TikZ for layout-precise figures,
  `pgfplots` for data plots, generated SVG→PDF for anything drawn elsewhere.
- One diagram, one message; the caption states the message in its first
  sentence so the figure survives being skimmed.
- Shared visual language across the document: the same node shapes for the same
  kinds of thing, the same arrow semantics. A legend once, at the first
  diagram.
- Fonts inside figures match the document (same family, sizes scaled to the
  figure) — a figure in a different typeface reads as pasted-in clip art.

## Maintenance at scale

- **Single source, multiple outputs**: the manual, the quick-reference card and
  the in-product help are views of one source when the tooling allows it.
- A changelog that names what changed per version, generated from commits or
  release notes where possible.
- Link checking in CI: a broken cross-reference in a 200-page manual is found
  by a reader or by nobody.
- Ownership: every part names an owner in the source; unowned parts are the
  ones that rot.

## Review workflow

- Procedures are reviewed by someone who *executed* them on a clean machine,
  not by someone who read them. The review artifact is the transcript.
- The review checklist: every command ran as printed, every verification
  produced the stated output, every decision branch was reachable, every
  cross-reference resolved.
- A procedure that has never been executed end-to-end is a draft, whatever its
  version number says.
