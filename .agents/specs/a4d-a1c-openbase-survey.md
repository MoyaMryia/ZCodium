# A4d / A1c 开源基座普查（Open-source Base Survey）

2026-09-22，GitHub 仓库搜索 API（未认证，10 次/分；部分查询被限流中断）。
目的：为 A4d（pdf-plugin 剩余 6 个排版渲染脚本）与 A1c（documents-plugin
scenes/ 与其余 references）找可借用的宽松许可基座。

## A4d：7 个原版脚本的基座可得性

| 原版脚本             | 行数 | 基座                                     | 处置               |
| -------------------- | ---- | ---------------------------------------- | ------------------ |
| `html2pdf-next.js`   | 754  | `eKoopmans/html2pdf.js`（MIT，★4925）    | **借**             |
| `html2poster.js`     | 288  | `Chenruishuo/posterly`（AGPL-3.0，★409） | 许可不兼容，**写** |
| `pdf.py`             | 3076 | 无直接对应                               | **写**             |
| `design_engine.py`   | 2816 | 无直接对应                               | **写**             |
| `toc_validate.py`    | 2069 | 搜索总量仅 2，无可用                     | **写**             |
| `poster_validate.py` | 1336 | 无直接对应                               | **写**             |
| `cover_render.py`    | 487  | 无直接对应                               | **写**             |

结论：**7 个里只有 1 个真有基座**。A4d 的主体仍是清-room 从零写，
`html2pdf` 是唯一可以真正"借"的。

## A1c：scenes/ 与 references/ 的基座

### 可借（宽松许可的 LaTeX 模板）

| 目标文件                        | 基座                                                                                        | 许可       |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| `scenes/resume.md`              | `billryan/resume`（★11450）、`jankapunkt/latexcv`（★3340）、`dnl-blkv/mcdowell-cv`（★2709） | MIT        |
| `scenes/academic.md`            | `pmichaillat/latex-paper`（★388）、`monetjoe/latex_paper_templates`（★58）                  | MIT        |
| `scenes/report.md`              | `NemoYuan2008/SJTU-Thesis-Proposal`（★190）                                                 | MIT        |
| `scenes/exam.md`                | `Purestone/chitshit`（★31，开卷考试 cheat sheet）、`VicaYang/THU-Exam-LaTeX-Template`       | MIT / LPPL |
| `references/chart-templates.md` | `xinychen/awesome-latex-drawing`（MIT，★2059）                                              | MIT        |
| `references/decorations.md`     | `xiaohanyu/awesome-tikz`（无许可，仅作索引）、`xinychen/awesome-latex-drawing`（MIT）       | MIT        |
| `references/math-formulas.md`   | `manumacc/math-latex`（CC-BY-SA-4.0）——许可偏 Copyleft，倾向**写**                          | —          |

### 无基座，写

`scenes/contract.md`、`scenes/copywriting.md`、`scenes/official-doc.md`、
`references/design-system.md`（1797 行）、`references/common-rules.md`（419）、
`references/faq.md`（323）。

## 许可判定

- **MIT**：可直接派生，保留署名。首选。
- **LPPL-1.3c**（LaTeX Project Public License）：真实开源许可，但要求**修改后的文件
  必须改名**，否则不得分发。派生模板类内容摩擦较大，作为次选，且必须记录更名。
- **AGPL-3.0**：`posterly` 属此。本仓库以 Apache-2.0 为主，引入 AGPL 组件会把
  组合产物的许可义务变重，**不借**。
- **无许可 / NOASSERTION**：不可用。`xiaohanyu/awesome-tikz`、
  `ndpvt-web/latex-document-skill`（27 模板，正合适但无许可）均因此排除。

## 处置原则

1. 有 MIT 基座且方向对口的 → 派生并署名，与 `spreadsheets-plugin` 的 `recalc.py`
   同路径。
2. 无基座或许可不合 → 清-room 从零写，按 `documents-doc-layer-cleanroom.md`
   的方法论，以我们自己的代码与公开知识为事实源。
3. 每条派生都在 `NOTICE.md` 记录来源、许可与 delta。
4. 借不了的**先写出来**，不为追求完整而阻塞：宁可先有一版可维护的独立实现，
   也不留空。
