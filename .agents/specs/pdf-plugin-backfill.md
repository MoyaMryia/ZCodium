# pdf-plugin 补全（PDF Plugin Backfill）

## 背景

RC-CHN 因 seed 契约不满足，把 `documents`、`pdf`、`spreadsheets` 从三处发行清单移除。
`documents` 已补齐并回到四处契约（见 `builtin-plugin-parity.md`）。`pdf-plugin`
目录尚不存在，官方 3.14.1 安装包内的原版结构为：

| 路径                      | 数量 | 性质                             |
| ------------------------- | ---- | -------------------------------- |
| `agents/visual-judge.md`  | 1    | 视觉评审 agent                   |
| `skills/pdf/SKILL.md`     | 1    | 路由技能                         |
| `skills/pdf/scripts/`     | 11   | 真实实现（设计引擎、渲染、校验） |
| `skills/pdf/briefs/`      | 9    | 分文档类型的排版 brief           |
| `skills/pdf/typesetting/` | 9    | 排版知识                         |
| `skills/pdf/configs/`     | 3    | 字体/组件/视觉框架配置           |
| `skills/pdf/env_setup/`   | 5    | 跨平台环境安装                   |
| `skills/pdf/references/`  | 2    | LaTeX 简历模板                   |

原版 `LICENSE.txt` 为 Z.ai 非商业许可，**不随本插件发布**；`license` 字段改为
`Apache-2.0`，来源声明写入 `NOTICE.md`，与 documents/presentations 的处理一致。

## 与 documents-plugin 的关键差异

documents 的 clean-room 路径是「从我们自己的 MIT 派生代码派生文档」。**pdf 没有这条路径**：
它的脚本是 Z.AI 原创实现，没有 MIT 基座可依。因此 pdf 的文档层只有两种来源：

1. **通用 LaTeX / 排版知识**——公开领域，可独立撰写，不触达原作。
2. **原作文档**——禁止。

所以 pdf 的技能层按路径 1 撰写：以 LaTeX、PDF 渲染管线、排版规则的公开知识为事实源，
不读取原版任何文档。这与「参考原作后改写」是不同性质的操作，但**弱于**
documents 那种「引用链完全不经过原作」的强度——因为排版领域的最佳实践集合有限，
独立撰写可能与原作在结论上重合（如「正文行高取 1.5」「页边距 2cm」）。
判定时区分：**事实性结论允许重合，表达与结构必须独立。**

## 范围

### Phase 1 — 可注册（本次范围）

| 产物                                                    | 派生来源                                    |
| ------------------------------------------------------- | ------------------------------------------- |
| `package.json`                                          | 契约字段，`license: Apache-2.0`             |
| `.zcode-plugin/plugin.json`                             | 契约字段，`name: pdf`                       |
| `NOTICE.md`                                             | 来源声明                                    |
| `agents/visual-judge.md`                                | PDF 页面的视觉评审；协议与 documents 版对齐 |
| `skills/pdf/SKILL.md`                                   | 路由：文档类型 → brief；渲染与校验流程      |
| `skills/pdf/briefs/report.md`、`resume.md`、`poster.md` | 三类高频文档的排版要点                      |

完成后把 `pdf` 加回四处契约，seed 路径为 6 项。

### Phase 2 — 脚本（未纳入，需单独排期）

原版 11 个脚本覆盖设计引擎、封面渲染、html2pdf、海报渲染、QA 校验。这些是真实实现，
从零重写需先定义接口契约与验收场景，工作量与 documents-plugin 的
`document.py` 同级。**Phase 1 不含任何脚本**，因此 Phase 1 的 SKILL.md 只描述
基于 LaTeX 与通用工具链的工作流，不引用尚不存在的脚本。

### Phase 3 — 完整文档层（未纳入）

其余 6 个 brief、9 个 typesetting、3 个 configs、5 个 env_setup、2 个 LaTeX 模板。

## 状态所有者与契约

- 四处契约清单见 `builtin-plugin-parity.md`；`pdf` 加入后与 `documents` 同规则。
- `requiredSeedPaths` 只列 Phase 1 真实存在的 6 个文件。**不得列 Phase 2/3 的文件**——
  列了会让 staging 直接抛 `missing staged official plugin seed asset`。
- `visual-judge.md` 的输出协议（每页一行 JSON、`category` 枚举
  `Spec | Visual | Design | Unverified`）与 documents/presentations 版逐字一致，
  这是宿主依赖的协议面。
- Phase 2 落地后必须同步扩充 seed 路径，否则装出「看得见技能、调不到脚本」的残缺插件。

## 验收场景

1. Phase 1 的 6 个文件存在，`pnpm typecheck`、`pnpm lint` 保持基线。
2. 四处契约均含 `pdf`，staging 模拟通过（用 `bundled-plugins.ts` 的顶层白名单走一遍，
   6 个必需路径全部可被 seed）。
3. **非复制证明**：Phase 1 的 markdown 对原版对应文件句级重合，表达性内容为 0。
4. **协议一致性**：`visual-judge.md` 的 frontmatter 键、JSON schema 键结构、
   `category` 枚举与 documents 版一致。
5. SKILL.md **不引用任何不存在的脚本**——Phase 1 无 scripts/ 目录。
6. 不引入 `LICENSE.txt`、`node_modules`、`__pycache__`、`*.pyc`。

## 非目标

- 不实现 Phase 2 的 11 个脚本。
- 不补 Phase 3 的剩余约 30 个文档。
- 不改 documents / presentations / spreadsheets 的任何内容。
- 不重新许可任何文件。
