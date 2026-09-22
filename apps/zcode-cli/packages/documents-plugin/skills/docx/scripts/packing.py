"""Self-contained DOCX packing helpers, split from scripts/document.py.

Clean-room reimplementation of the same lineage described in the
scripts/document.py module docstring; the MIT-licensed reference
implementation lives at:

    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton, MIT License
"""


import shutil
import tempfile
import zipfile
from pathlib import Path

from defusedxml import minidom


# ---------------------------------------------------------------------------
# 自包含打包
#
# 上游把 pack_document 放在 ooxml/scripts/pack.py，并依赖同树的 XSD schema 校验器
# 与 redlining 校验器。本插件不发布那棵树，所以这里内联一份等价的打包实现：
# 读入解包目录，剥掉无意义的格式化空白与注释，重新压成 .docx。
#
# 剥空白不是优化而是正确性要求：Word 对 settings.xml 这类部件的子元素顺序敏感，
# 而美化打印留下的换行与缩进会被解析成文本节点，混进元素序列里。
# ---------------------------------------------------------------------------


def _strip_formatting_whitespace(xml_file):
    """Remove inter-element whitespace and comments from an XML part, in place."""
    with open(xml_file, encoding="utf-8") as handle:
        dom = minidom.parse(handle)
    for element in dom.getElementsByTagName("*"):
        # w:t 一类承载正文的节点整体跳过：那里的空白是内容，不是格式。
        if element.tagName.endswith(":t"):
            continue
        for child in list(element.childNodes):
            is_blank_text = (
                child.nodeType == child.TEXT_NODE
                and child.nodeValue
                and child.nodeValue.strip() == ""
            )
            if is_blank_text or child.nodeType == child.COMMENT_NODE:
                element.removeChild(child)
    with open(xml_file, "wb") as handle:
        handle.write(dom.toxml(encoding="UTF-8"))


def _pack_document(input_dir, output_file):
    """Pack an unpacked document directory back into a .docx archive."""
    input_dir = Path(input_dir)
    output_file = Path(output_file)
    # 在临时目录里加工：剥空白的结果不该写回用户手中的解包目录。
    with tempfile.TemporaryDirectory() as temp_dir:
        staged = Path(temp_dir) / "content"
        shutil.copytree(input_dir, staged)
        for pattern in ("*.xml", "*.rels"):
            for part in staged.rglob(pattern):
                _strip_formatting_whitespace(part)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_file, "w", zipfile.ZIP_DEFLATED) as archive:
            for part in staged.rglob("*"):
                if part.is_file():
                    archive.write(part, part.relative_to(staged))

# Path to template files
TEMPLATE_DIR = Path(__file__).parent / "templates"
