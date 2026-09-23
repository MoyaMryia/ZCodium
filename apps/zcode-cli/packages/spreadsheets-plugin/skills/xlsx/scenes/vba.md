# VBA and macros

When a workbook needs logic that formulas cannot express — or when the task
arrives as "this macro does X". VBA lives in the `.xlsm` container; the
guidance here is language-level, written from the public VBA grammar.

## Container rules

- A macro-enabled workbook is `.xlsm`. Saving VBA as `.xlsx` silently deletes
  the project — the single most destructive mistake in this scene.
- openpyxl has `keep_vba=True` on `load_workbook` for preserving an existing
  project; it cannot create or compile one.
- LibreOffice can run and edit VBA but its dialect differs in edge cases; a
  macro that must run everywhere is tested in both.

## Anatomy

    Option Explicit

    Sub RefreshReport()
        Dim ws As Worksheet
        Set ws = ThisWorkbook.Worksheets("Report")
        Application.ScreenUpdating = False
        ws.Range("A1").Value = Now()
        Application.ScreenUpdating = True
    End Sub

- `Option Explicit` at the top of every module: an undeclared variable is a
  typo that becomes a new empty variable.
- `Sub` does not return a value; `Function` does.
- `Dim` every variable with a type. `Variant` everywhere is how a macro ends
  up comparing text to a number and silently failing.
- `Set` for object assignments (`Set ws = ...`); a missing `Set` is a type
  error at runtime, not at compile time.

## The patterns that matter

**Iterate a used range without walking a million rows:**

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    For r = 2 To lastRow
        ' ...
    Next r

`Cells(Rows.Count, col).End(xlUp).Row` is the reliable "last row"; `UsedRange`
includes formatted-but-empty rows and over-reports.

**Write in bulk, not cell by cell:**

    ws.Range("A2:A1000").Value = dataArray

A cell-at-a-time loop over a large range is the classic macro that "used to
take a second and now takes ten minutes". Read into a variant array, transform
in memory, write the array back.

**Error handling that reports rather than swallows:**

    On Error GoTo Handler
    ' ...
    Exit Sub
    Handler:
    MsgBox "RefreshReport failed at step " & step & ": " & Err.Description
```

An empty `On Error Resume Next` hides every defect in the macro; if it is
genuinely needed, bound it to the single statement that may fail.

**Never trust the active sheet.** `ActiveSheet` is whatever the user last
clicked. Qualify every range with its worksheet (`ws.Range(...)`), or the
macro edits the wrong sheet on someone else's machine.

## When macros are the wrong answer

- The logic can be a formula: a formula recalculates, a macro only runs when
  invoked. Prefer the formula.
- The task is a one-off transformation of data: a script (openpyxl) is
  testable, reviewable and does not require macro permissions.
- The workbook must run in a locked-down environment: macros are disabled by
  policy in most enterprises, and a workbook that depends on them fails there.

## Security

- Macros execute with the user's permissions. A macro from an untrusted source
  is untrusted code; open the project and read it before enabling anything.
- `ThisWorkbook` is the file containing the code; `ActiveWorkbook` is whatever
  is focused — a macro that edits `ActiveWorkbook` can write outside the file
  it shipped in.
- Digitally sign a macro that ships to others; an unsigned macro prompts on
  every open and trains users to click through warnings.

## Core principles

### 1. Safety first

A macro runs with the user's permissions and edits real files. The minimum
safety set:

- **Never operate on `ActiveWorkbook`** when the macro ships inside a file —
  use `ThisWorkbook`. A macro that edits whatever happens to be focused can
  write outside the file it shipped in.
- **Back up before the first write**: copy the target file within the macro,
  or refuse to run when a backup cannot be made.
- **`Application.Calculation = xlCalculationManual`** around any block that
  writes many cells, restored on every exit path including the error handler.
- **Guard on the workbook identity** (`If ThisWorkbook.Name <> "model.xlsm"`)
  — macros get copied between workbooks by well-meaning users, and a guard
  turns a silent wrong-file edit into a visible refusal.

### 2. The openpyxl VBA workflow

openpyxl preserves an existing VBA project with `keep_vba=True` on
`load_workbook`, and cannot create or compile one. So the workflow is:

1. Author the macro in the VBA editor (or keep a `.bas` module in source
   control).
2. `load_workbook(path, keep_vba=True)`, edit the cells, `save(path)` — the
   project survives the round-trip.
3. **Verify** by re-loading and checking the project is still there; a save
   that silently drops the project is the failure this check exists for.
4. Save as `.xlsm` always — saving VBA as `.xlsx` deletes the project.

### 3. File format rules

- `.xlsm` for anything with a project; `.xlsx` for anything without.
- The project is part of the deliverable: a workbook whose macro was stripped
  in the last save is a defect, and the check in step 3 is the gate.
- LibreOffice can run and edit VBA but its dialect differs in edge cases; a
  macro that must run everywhere is tested in both.

## Naming and declaration standards

- **Naming**: `Sub`/`Function` names are verbs (`RefreshReport`), variables are
  camelCase with a type prefix where the type is not obvious (`wsData`,
  `lastRow`), and constants are SCREAMING_SNAKE. One name per concept across
  the project.
- **`Option Explicit` in every module** — an undeclared variable is a typo that
  becomes a new empty variable.
- **`Dim` with explicit types**; `Variant` only where the value genuinely varies
  in type (a parsed cell). `Variant` everywhere is how a macro ends up comparing
  text to a number and silently failing.
- **`Set` for object assignments** (`Set ws = ...`); a missing `Set` is a
  runtime type error, not a compile error.
- **Error handling reports rather than swallows**: `On Error GoTo Handler` with
  a `MsgBox` naming the step and `Err.Description`. An empty
  `On Error Resume Next` hides every defect; if one statement genuinely needs
  it, bound the handler to that statement and restore it immediately.

## The patterns that matter

- **Last row**: `ws.Cells(ws.Rows.Count, "A").End(xlUp).Row` — not `UsedRange`,
  which over-reports on formatted-but-empty cells.
- **Bulk read/write**: `values = ws.Range(...).Value` into a variant array,
  transform in memory, write back in one assignment. A cell-at-a-time loop over
  a large range is the macro that "used to take a second".
- **Filter and copy visible rows**: `SpecialCells(xlCellTypeVisible)` — the
  only correct way to touch "the visible rows".
- **Log every run** (append mode, `Format(Now(), ...)`): a macro that writes no
  log cannot be debugged after the fact.
