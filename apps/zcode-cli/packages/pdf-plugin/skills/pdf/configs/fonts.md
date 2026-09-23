# Font configuration

Choosing, loading and verifying fonts for a document. The decision tree is
short; the failures are all about what the build machine actually has.

## Decide by need

| the document is… | engine | font mechanism |
| --- | --- | --- |
| Latin text, maximum package compatibility | pdfLaTeX | Type 1 packages: `lmodern`, `newtxtext`, `libertine` |
| system fonts, OpenType features | XeLaTeX | `fontspec` by family name |
| CJK text | XeLaTeX or LuaLaTeX | `fontspec` + `xeCJK` / `ctex`, faces named explicitly |
| LuaTeX-side scripting needed | LuaLaTeX | `fontspec` + Lua |

## Load order

1. `\usepackage[T1]{fontenc}` (pdfLaTeX) — without it, accented hyphenation
   breaks and copied text garbles.
2. `\usepackage{fontspec}` (XeLaTeX/LuaLaTeX) — before any package that must
   see the font setup.
3. `\setmainfont`, `\setsansfont`, `\setmonospace` — by *family name*, with the
   fallback chain spelled out.
4. `\usepackage[utf8]{inputenc}` is the default in modern LaTeX and can be
   omitted; saying it explicitly harms nothing.
5. `microtype` last among the font-related packages.

## Naming faces safely

    \setmainfont{TeX Gyre Pagella}
    \IfFontExistsTF{Noto Serif CJK SC}{%
      \newfontfamily\cjkfont{Noto Serif CJK SC}%
    }{%
      \newfontfamily\cjkfont{WenQuanYi Micro Hei}%
    }

`\IfFontExistsTF` (fontspec) turns a missing face into a fallback instead of a
build error — use it whenever the document will be built on more than one
machine.

## Preamble checklist

- [ ] `fontenc` T1 on pdfLaTeX.
- [ ] Two families named, both installed on the build machine.
- [ ] CJK face named explicitly (never the default fallback).
- [ ] Math font matches the text family (`newtxmath`, `unicode-math`).
- [ ] `microtype` loaded.

## Verify after the build

    pdffonts document.pdf

- Every line names a face you chose.
- `emb yes` on every font — an unembedded font renders differently on the next
  machine and is a print-shop rejection.
- No face you did not choose appears: that is a substitution, and the
  substitution's metrics re-wrapped the document.

## Font availability

`env_setup/font_list.txt` lists the faces this skill's documents name, with
their sources. Install from there before a build that needs a specific face;
refresh the font cache (`fc-cache -f`) after installing system fonts.
