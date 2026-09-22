# Math formulas

How equations are numbered, aligned and placed in a `.docx`, and where the plugin's
help stops. **This plugin has no equation builder.** There is no macro layer, no
LaTeX-to-OOXML translator and no symbol palette: an equation is an `m:oMath` fragment
you write yourself and insert through the editor. Everything below is the conventions
that fragment has to satisfy.

## 1. Inline or display

|             | inline                       | display                                        |
| ----------- | ---------------------------- | ---------------------------------------------- |
| element     | `m:oMath`                    | `m:oMathPara` containing one or more `m:oMath` |
| where       | inside a `w:r`, mid-sentence | a child of `w:p`, on its own line              |
| punctuation | the sentence's               | its own, when it ends a sentence               |
| numbering   | none                         | optional, on the right                         |

The namespace for both is
`http://schemas.openxmlformats.org/officeDocument/2006/math`.

An inline equation is part of the sentence and takes the sentence's punctuation —
including the comma. A display equation is a sentence of its own: it gets a period
when the text stops there, and nothing when the text continues on the next line.

A formula short enough to sit inline stays inline. An inline formula that wraps
across two lines is a display formula that has not been given a line of its own.

## 2. The anatomy of a display equation

```xml
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pPr>
    <w:jc w:val="center"/>
    <w:spacing w:before="120" w:after="120"/>
  </w:pPr>
  <m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
    <m:oMathParaPr>
      <m:jc w:val="center"/>
    </m:oMathParaPr>
    <m:oMath>
      <m:r><m:t>E</m:t></m:r>
      <m:sSub>
        <m:e><m:r><m:t>X</m:t></m:r></m:e>
        <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
      </m:sSub>
      <m:r><m:t>=</m:t></m:r>
      <m:d>
        <m:dPr>
          <m:begChr m:val="("/>
          <m:endChr m:val=")"/>
          <m:ctrlPr/>
        </m:dPr>
        <m:e>
          <m:f>
            <m:num><m:r><m:t>1</m:t></m:r></m:num>
            <m:den><m:r><m:t>N</m:t></m:r></m:den>
          </m:f>
        </m:e>
      </m:d>
    </m:oMath>
  </m:oMathPara>
</w:p>
```

`m:oMathParaPr/m:jc` centres the block; `w:pPr/w:jc` centres the paragraph that
holds it. Set both — some readers honour one and not the other. `m:jc` accepts
`center`, `left` and `right`.

The building blocks, all in the `m:` namespace:

| element                         | for                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `m:r`                           | a run of math text; `m:rPr/m:sty` sets `p` plain, `i` italic, `b` bold, `bi` |
| `m:f`                           | a fraction — `m:num` over `m:den`                                            |
| `m:sSub`, `m:sSup`, `m:sSubSup` | a sub- and/or superscript on an `m:e` base                                   |
| `m:nary`                        | a large operator with `m:sub` / `m:sup` and `m:naryPr/m:chr` for the sign    |
| `m:d`                           | a delimited group — `m:begChr` / `m:endChr` around an `m:e`                  |
| `m:func`                        | a function name in `m:fName` applied to an `m:e`                             |
| `m:limLow`, `m:limUpp`          | limits below or above an operator, rather than beside it                     |
| `m:acc`, `m:bar`, `m:rad`       | an accent, an overbar, a radical (`m:rad` carries `m:deg`)                   |
| `m:eqArr`                       | an array of equations, aligned — one `m:e` per row                           |
| `m:m`                           | a matrix — `m:mr` rows of `m:e` cells                                        |
| `m:groupChr`                    | a brace or bracket grouping rows of cases                                    |

Variables are italic by default in math runs; operators, digits and function names
are not. `m:rPr/m:sty` overrides it when the default is wrong.

## 3. Numbering

- The number is **not part of the equation**. It is a separate right-aligned run in
  the same paragraph, or a separate paragraph, so it can be cross-referenced and it
  survives the equation being edited.
- The reliable OOXML mechanism is a `SEQ` field: a right-aligned tab at the right
  margin, then the field. A typed `(3)` does not renumber when an equation is
  inserted, and a numbered equation set is exactly the thing that grows.
- Number only equations the text refers to. An unnumbered display equation is
  perfectly correct and saves the reader a lookup.
- Number continuously through the document, or per chapter with the counter reset —
  pick one. `A.1`, `A.2` in an appendix is the convention when the appendix restarts.
- The number sits in parentheses at the right margin, on the equation's own line.

## 4. Alignment

- One equation per line, centred, is the default and is right for almost everything.
- A multi-line derivation aligns on a relation — usually the `=` — not on the left
  edge. In OOXML that is `m:eqArr` with one `m:e` per row, inside a single
  `m:oMathPara`; the alignment point is the same column on every row.
- `=` broken across a line goes at the **start** of the continuation line, not at the
  end of the first. A trailing `=` reads as an unfinished line.
- A derivation that is not aligned is a sequence of equations; a derivation that is
  aligned is an argument. The difference is visible at a glance.
- Do not align with spaces. Math runs are not monospaced, and a hand-aligned column
  collapses the moment a symbol changes.

## 5. Breaking across pages

- A display equation is a paragraph like any other: `w:keepLines` keeps it whole,
  `w:keepNext` keeps it with the text that introduces it.
- A long derivation may break between rows, never inside a row. That is a property of
  `m:eqArr` plus the paragraph's widow/orphan control, not of the equation.
- An equation separated from the sentence that introduces it is a defect even though
  nothing in the file is invalid.

## 6. Cross-referencing

- A bookmark on the equation's paragraph, and a `REF` field in the text, resolves to
  the number. A typed "equation (3)" drifts.
- The bookmark name is prefixed (`eq:`), unique, and says what the equation is:
  `eq:bayes-update`, not `_Ref12345`.
- Reference the number, not the page. "Substituting into (7)" survives a reflow;
  "substituting into the equation on page 12" does not.

## 7. Naming conventions

There is no macro layer here, so a repeated expression is a repeated fragment. Two
mitigations, both structural rather than automatic:

- Factor the expression. A term that appears in five equations is five chances to
  disagree with itself; a definition it can be substituted into is one.
- Keep the equations in one part. `word/document.xml` holds them; do not split a
  derivation across a header, a footer and a text box, because the editor finds
  nodes by part and a fragment split across parts cannot be edited as one thing.

Where a document genuinely needs a macro layer — `\E` for an expectation, `\norm`
for a norm — the answer is a template with the macros expanded at build time, not a
fragment library in the `.docx`.

## 8. Interaction with the gate

Three rules touch equations, and two of them are surprising:

- **`blank-pages` counts a display equation as an empty paragraph.** The rule looks
  for text, a page break, or a drawing; an `m:oMathPara` paragraph has none of the
  three, because a drawing means `wp:inline` or `wp:anchor` and math is neither. Five
  or more consecutive display equations with no text between them is reported as a
  blank-page pattern. Either put a line of text between them, or scope the rule with
  `--only` and record why.
- **`line-spacing` skips an equation paragraph**, for the same reason: it has no text.
  Equations may carry their own leading without tripping the rule.
- **`cjk-indent` skips an equation paragraph** as well, because it contains no CJK
  text. An equation between two Chinese paragraphs does not need an indent and does
  not need to be exempted by hand.

A paragraph that mixes Chinese text and an inline `m:oMath` is body text for all
three rules, and behaves accordingly.

## 9. Checklist

- Inline formulas part of the sentence; display formulas on their own line.
- `m:oMathParaPr/m:jc` and `w:pPr/w:jc` both set on every display equation.
- Numbered equations numbered by a `SEQ` field, right-aligned, in parentheses; only
  the ones the text refers to.
- Multi-line derivations in `m:eqArr`, aligned on the relation, breaking only
  between rows.
- Every referenced equation carrying a `eq:` bookmark and a `REF` field in the text.
- No run of five or more consecutive display equations without intervening text, or
  `blank-pages` scoped and the reason recorded.
