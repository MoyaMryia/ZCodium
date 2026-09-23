# VBA templates

Copy-adapt starting points for the recurring macro jobs. Language-level
patterns written from the public VBA grammar; the rules behind them are in
`scenes/vba.md`. Every module starts with `Option Explicit`.

## 1. Safe skeleton

    Option Explicit

    Sub DoTheThing()
        Dim ws As Worksheet
        Dim lastRow As Long
        Dim r As Long

        On Error GoTo Handler
        Set ws = ThisWorkbook.Worksheets("Data")

        lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
        For r = 2 To lastRow
            ' work
        Next r

        Exit Sub
    Handler:
        MsgBox "DoTheThing failed: " & Err.Description, vbCritical
    End Sub

Never `On Error Resume Next` at the top of a module; if one statement may
fail, bound the handler to that statement and restore it immediately.

## 2. Read a column into an array, transform, write back

    Option Explicit

    Sub DoubleColumnB()
        Dim ws As Worksheet
        Dim lastRow As Long
        Dim values As Variant
        Dim r As Long

        Set ws = ThisWorkbook.Worksheets("Data")
        lastRow = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row
        If lastRow < 2 Then Exit Sub

        values = ws.Range("B2:B" & lastRow).Value      ' 2-D variant array
        For r = 1 To UBound(values, 1)
            If IsNumeric(values(r, 1)) Then
                values(r, 1) = values(r, 1) * 2
            End If
        Next r
        ws.Range("B2:B" & lastRow).Value = values      ' one write
    End Sub

`Range.Value` on a multi-cell range returns a **1-based, two-dimensional**
array even for a single column — `values(r, 1)`, not `values(r)`. Writing the
array back in one assignment is what keeps the macro fast.

## 3. Filter and copy visible rows

    Option Explicit

    Sub CopyFilteredRows()
        Dim src As Worksheet, dst As Worksheet
        Dim lastRow As Long

        Set src = ThisWorkbook.Worksheets("Data")
        Set dst = ThisWorkbook.Worksheets("Report")

        lastRow = src.Cells(src.Rows.Count, "A").End(xlUp).Row
        src.Range("A1:D" & lastRow).AutoFilter
        src.Range("A1:D" & lastRow).AutoFilter Field:=4, Criteria1:="Open"

        src.Range("A1:D" & lastRow).SpecialCells(xlCellTypeVisible).Copy
        dst.Range("A1").PasteSpecial xlPasteValues
        dst.Range("A1").PasteSpecial xlPasteFormats
        Application.CutCopyMode = False
        src.AutoFilterMode = False
    End Sub

`SpecialCells(xlCellTypeVisible)` is the only correct way to touch "the
visible rows"; a loop over `Hidden` is slower and wrong after a manual
re-filter. `xlCellTypeVisible` raises when nothing is visible — guard it if
the filter can legitimately match zero rows.

## 4. Recalculate and export one sheet to PDF

    Option Explicit

    Sub ExportReport()
        Dim ws As Worksheet
        Dim pdfPath As String

        Application.Calculation = xlCalculationManual
        Application.ScreenUpdating = False
        On Error GoTo Restore

        Set ws = ThisWorkbook.Worksheets("Report")
        Application.Calculate
        ws.ExportAsFixedFormat Type:=xlTypePDF, _
            Filename:=ThisWorkbook.Path & "\report.pdf", _
            Quality:=xlQualityStandard, IncludeDocProperties:=True

    Restore:
        Application.Calculation = xlCalculationAutomatic
        Application.ScreenUpdating = True
    End Sub

`ExportAsFixedFormat` honours the sheet's print area and page setup — the
print setup is part of the deliverable (`scenes/advanced.md`). Setting
calculation to manual around the block is what stops a full-workbook
recalculation on every keystroke-sized change.

## 5. Log a run (the audit trail a macro otherwise lacks)

    Option Explicit

    Sub LogRun(ByVal step As String)
        Dim fso As Object, logFile As Object
        Set fso = CreateObject("Scripting.FileSystemObject")
        Set logFile = fso.OpenTextFile( _
            ThisWorkbook.Path & "\macro-run.log", 8, True)
        logFile.WriteLine Format(Now(), "yyyy-mm-dd hh:nn:ss") & _
            " " & step & " by " & Application.UserName
        logFile.Close
    End Sub

Append mode (`8`), `True` creates the file on first run. A macro that writes
no log cannot be debugged after the fact — the log is the macro's only
observability.

## 6. Guard: refuse to run on the wrong workbook

    Option Explicit

    Sub GuardedMacro()
        If ThisWorkbook.Name <> "model.xlsm" Then
            MsgBox "This macro belongs to model.xlsm.", vbExclamation
            Exit Sub
        End If
        ' ...
    End Sub

Macros get copied between workbooks by well-meaning users. A guard turns a
silent wrong-file edit into a visible refusal.

## Cross-cutting rules

- `ThisWorkbook` for the file containing the code; `ActiveWorkbook` is
  whatever happens to be focused.
- `Application.ScreenUpdating` / `Calculation` are saved and restored on every
  exit path, including the error handler.
- Every `Sub` that mutates data writes a log line (template 5).
- `Option Explicit` in every module; `Dim` with explicit types; `Set` for
  objects.

## Template 5 — button-triggered automation

The pattern for a macro a user runs by clicking, not by opening the editor:

    Option Explicit

    Sub OnButtonClick()
        ' 1. Guard: refuse to run on the wrong workbook.
        If ThisWorkbook.Name <> "model.xlsm" Then
            MsgBox "This macro belongs to model.xlsm.", vbExclamation
            Exit Sub
        End If

        ' 2. Back up before the first write.
        On Error GoTo Handler
        Dim backup As String
        backup = ThisWorkbook.Path & "\model-backup-" & Format(Now(), "yyyymmdd-hhnnss") & ".xlsm"
        ThisWorkbook.SaveCopyAs backup

        ' 3. The work, with calculation manual so the writes do not each
        '    trigger a full recalculation.
        Application.Calculation = xlCalculationManual
        Application.ScreenUpdating = False
        RefreshReport

        ' 4. Restore on every exit path.
        Application.Calculation = xlCalculationAutomatic
        Application.ScreenUpdating = True
        LogRun "OnButtonClick ok, backup=" & backup
        MsgBox "Done. Backup: " & backup, vbInformation
        Exit Sub

    Handler:
        Application.Calculation = xlCalculationAutomatic
        Application.ScreenUpdating = True
        MsgBox "Failed at " & Err.Source & ": " & Err.Description, vbCritical
    End Sub

The four numbered steps are the whole pattern: guard, back up, work with the
environment restored, log. A button macro missing any of them is a macro that
will eventually destroy someone's file with no record of what happened.

## Template 6 — protected sheet with editable ranges

A sheet that is protected except where the user must type:

    Sub ProtectInputs()
        Dim ws As Worksheet
        Set ws = ThisWorkbook.Worksheets("Assumptions")

        ' Unlock exactly the input cells, then protect the sheet.
        ws.Range("B2:B20").Locked = False        ' the input column
        ws.Cells.Locked = True                   ' everything else

        ws.Protect Password:="", DrawingObjects:=True, Contents:=True, _
                  Scenarios:=True, AllowFiltering:=True

        ' Structure protection is separate: no adding, deleting, hiding or
        ' renaming sheets. A workbook whose structure is unprotected loses its
        ' hidden sheets to the first stray click.
        ThisWorkbook.Protect Structure:=True
    End Sub

- Unlock before protecting, cell by cell or by range — a protected sheet with
  everything locked is a sheet nobody can use.
- State the protection in the delivery note; a protected workbook that
  surprises the recipient generates a support request.
- `AllowFiltering` (and `AllowSorting`) are the options users miss first —
  grant them unless the protection exists to prevent reordering.
