# Environment setup

What the pdf skill needs on a machine, what each piece is for, and how to get
it. `env_check.sh` detects; `setup_mac_linux.sh` installs the small pieces on
macOS and Linux; `setup_windows.ps1` does the same on Windows.

## The pieces

| piece | why it is needed | how it arrives |
| --- | --- | --- |
| TeX distribution | `latexmk`, the engines, `biber`, the packages | a deliberate, large install — see below |
| poppler | `pdftoppm` rasterizes pages for the visual gate; `pdfinfo`/`pdffonts` inspect the artifact | small; package manager on every platform |
| LibreOffice | the only renderer `html2pdf.py` and `cover_render.py` use | large (~400 MB); install on demand, never substitute |
| Python ≥ 3.10 | runs `scripts/` — form filling, QA, bounding boxes | package manager or python.org |
| Python deps | `pypdf`, `pdf2image`, `Pillow` — declared per script in PEP 723 headers | `pip install` |

## TeX distribution

Not installed by the setup scripts: the choice is the user's, and the download
is large.

- **TeX Live** (Linux, also macOS/Windows): full scheme recommended;
  `tlmgr install <pkg>` adds packages afterwards.
- **MacTeX** (macOS): TeX Live plus macOS extras; binaries land in
  `/Library/TeX/texbin`.
- **MiKTeX** (Windows): installs missing packages on the fly — pass
  `-interaction=nonstopmode` so a missing package never blocks the build on a
  console prompt.

A minimal TeX Live install often omits `latexmk`, `biber`,
`collection-fontsrecommended` and the language collections. A document that
builds on one machine and fails on another is almost always a
package-collection difference, not a source difference.

## Rasterizer

Any one of these satisfies the visual gate:

- poppler — `pdftoppm` / `pdftocairo` (the common choice; `apt install poppler-utils`, `brew install poppler`)
- mupdf — `mutool draw`
- ghostscript — `gs`
- ImageMagick — `magick` (its PDF delegate is ghostscript anyway)

## LibreOffice — install on demand, never substitute

Required when the task is the HTML path or a cover render. Absent means the
task fails with an explanation — it is never silently switched to another
program, and the visual check is never skipped because the download is large.

If it is already on disk but off `PATH`, register the binary instead of
reinstalling:

- macOS: `sudo ln -sf /Applications/LibreOffice.app/Contents/MacOS/soffice /usr/local/bin/soffice`
- Linux: `sudo ln -sf /opt/libreoffice*/program/soffice /usr/local/bin/soffice`
- Windows: add the install directory to the user `PATH`, then re-verify
  `soffice --version`

## Fonts

`font_list.txt` lists the faces this skill's documents name, with sources.
Install before a build that needs a specific face — a missing face is a
substitution, and a substitution re-wraps every line.

## Python dependencies

Each executable script under `scripts/` declares its own dependencies in a PEP
723 header (`requires-python` and the imports it needs). The usual set:

```bash
python3 -m pip install pypdf pdf2image Pillow
```

PEP 668 (externally-managed environment) refusals are handled with
`--user`, a venv, or by pointing `PYTHON` at the venv interpreter — the setup
scripts try the plain install first and report the alternatives on refusal.

## Verifying

```bash
bash env_setup/env_check.sh     # exit 0 = buildable
```

A `[WARN]` is a conditional gap (a tool a particular document path needs); a
`[FAIL]` is a blocker. Re-run after installing anything.
