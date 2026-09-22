# /// script
# requires-python = ">=3.10"
# dependencies = ["openpyxl"]
# ///
#
# Excel Formula Recalculation Script
# Recalculates all formulas in an Excel file using LibreOffice
#
# Derived from `xlsx/recalc.py` of appautomaton/document-SKILLs
# (https://github.com/appautomaton/document-SKILLs),
# Copyright (c) 2026 appautomaton, MIT License.
#
# MIT License
#
# Copyright (c) 2026 appautomaton
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#
# Changes from the upstream file: the PEP 723 header declares the lowest
# interpreter that actually runs it (`>=3.10` instead of `>=3.12`; the code
# uses no post-3.10 syntax), and the usage text names this repository's
# `python3` invocation instead of `uv run`. Formula recalculation, macro setup,
# error scanning and the JSON result shape are unchanged. External
# dependencies are still `openpyxl` (import) and LibreOffice `soffice` (PATH);
# when `soffice` is missing `recalc()` returns `{'error': ...}` rather than
# raising.
#
# One behavioural fix on top of the upstream: the LibreOffice invocation used an
# external `timeout`/`gtimeout` wrapper, which only signals the direct child. The
# `soffice` launcher spawns `soffice.bin` to do the work, so when a stale document
# lock left soffice.bin blocked the launcher was killed while soffice.bin survived
# orphaned and kept the stdout/stderr pipes open — `subprocess.run` then never
# returned and the script hung forever. It now starts soffice in its own process
# group and kills the whole group on timeout, which also drops the need for
# `gtimeout` on macOS.

import json
import sys
import signal
import subprocess
import os
import platform
import shutil
from pathlib import Path
from openpyxl import load_workbook

EXCEL_ERRORS = ['#VALUE!', '#DIV/0!', '#REF!', '#NAME?', '#NULL!', '#NUM!', '#N/A']

# 杀掉进程组后仍要留一点时间把管道里的残余读完，否则第二次 communicate 可能再抛超时。
KILL_DRAIN_TIMEOUT_SECONDS = 5


def _kill_process_tree(process):
    """Kill the child and everything it spawned, so its pipes actually close.

    On POSIX the child was started with start_new_session=True, so it leads its own
    process group and killing that group reaches soffice.bin, which the plain
    `timeout` command never did. On Windows there is no process group, so fall back
    to killing the direct child.
    """
    if process.poll() is not None:
        return
    try:
        if platform.system() == 'Windows':
            process.kill()
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        process.kill()
    try:
        process.communicate(timeout=KILL_DRAIN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        pass


def setup_libreoffice_macro():
    """Setup LibreOffice macro for recalculation if not already configured"""
    if platform.system() == 'Darwin':
        macro_dir = os.path.expanduser('~/Library/Application Support/LibreOffice/4/user/basic/Standard')
    else:
        macro_dir = os.path.expanduser('~/.config/libreoffice/4/user/basic/Standard')

    macro_file = os.path.join(macro_dir, 'Module1.xba')

    if os.path.exists(macro_file):
        with open(macro_file, 'r') as f:
            if 'RecalculateAndSave' in f.read():
                return True

    if not os.path.exists(macro_dir):
        subprocess.run(['soffice', '--headless', '--terminate_after_init'],
                      capture_output=True, timeout=10)
        os.makedirs(macro_dir, exist_ok=True)

    macro_content = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">
    Sub RecalculateAndSave()
      ThisComponent.calculateAll()
      ThisComponent.store()
      ThisComponent.close(True)
    End Sub
</script:module>'''

    try:
        with open(macro_file, 'w') as f:
            f.write(macro_content)
        return True
    except Exception:
        return False


def recalc(filename, timeout=30):
    """
    Recalculate formulas in Excel file and report any errors

    Args:
        filename: Path to Excel file
        timeout: Maximum time to wait for recalculation (seconds)

    Returns:
        dict with error locations and counts
    """
    if not Path(filename).exists():
        return {'error': f'File {filename} does not exist'}

    if shutil.which('soffice') is None:
        return {'error': "LibreOffice ('soffice') not found on PATH. Install it "
                         "(`brew install --cask libreoffice` or `apt-get install libreoffice`) and retry."}

    abs_path = str(Path(filename).absolute())

    if not setup_libreoffice_macro():
        return {'error': 'Failed to setup LibreOffice macro'}

    cmd = [
        'soffice', '--headless', '--norestore',
        'vnd.sun.star.script:Standard.Module1.RecalculateAndSave?language=Basic&location=application',
        abs_path
    ]

    # LibreOffice 的 `soffice` 启动器只负责拉起真正干活的 soffice.bin。早先这里用外部
    # `timeout`/`gtimeout` 包住命令，但它只向直接子进程发信号：一旦 soffice.bin 因陈旧
    # 文档锁 `.~lock.<file>#` 而阻塞，启动器被杀掉，soffice.bin 却被孤儿化并继续持有
    # stdout/stderr 管道，`subprocess.run(capture_output=True)` 永不返回，整个脚本挂死。
    # 改用 Python 自己的超时，并把 soffice 放进独立进程组，超时后连组一起杀，管道才会关闭。
    popen_kwargs = {}
    if platform.system() != 'Windows':
        popen_kwargs['start_new_session'] = True

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            **popen_kwargs,
        )
    except FileNotFoundError:
        return {'error': "LibreOffice ('soffice') not found on PATH. Install it "
                         "(`brew install --cask libreoffice` or `apt-get install libreoffice`) and retry."}

    try:
        _, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill_process_tree(process)
        return {
            'error': (
                f'LibreOffice did not finish within {timeout}s. A stale document '
                f'lock (.~lock.<name>#) beside the file leaves soffice.bin blocked; '
                f'remove it and retry.'
            )
        }

    if process.returncode != 0:
        error_msg = stderr or 'Unknown error during recalculation'
        if 'Module1' in error_msg or 'RecalculateAndSave' in error_msg:
            return {'error': f'LibreOffice macro not configured properly: {error_msg}'}
        return {'error': error_msg}

    # Check for Excel errors in the recalculated file - scan ALL cells
    try:
        wb = load_workbook(filename, data_only=True)

        error_details = {err: [] for err in EXCEL_ERRORS}
        total_errors = 0

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            # Check ALL rows and columns - no limits
            for row in ws.iter_rows():
                for cell in row:
                    if cell.value is not None and isinstance(cell.value, str):
                        for err in EXCEL_ERRORS:
                            if err in cell.value:
                                location = f"{sheet_name}!{cell.coordinate}"
                                error_details[err].append(location)
                                total_errors += 1
                                break

        wb.close()

        # Build result summary
        result = {
            'status': 'success' if total_errors == 0 else 'errors_found',
            'total_errors': total_errors,
            'error_summary': {}
        }

        # Add non-empty error categories
        for err_type, locations in error_details.items():
            if locations:
                result['error_summary'][err_type] = {
                    'count': len(locations),
                    'locations': locations[:20]  # Show up to 20 locations
                }

        # Add formula count for context - also check ALL cells
        wb_formulas = load_workbook(filename, data_only=False)
        formula_count = 0
        for sheet_name in wb_formulas.sheetnames:
            ws = wb_formulas[sheet_name]
            for row in ws.iter_rows():
                for cell in row:
                    if cell.value and isinstance(cell.value, str) and cell.value.startswith('='):
                        formula_count += 1
        wb_formulas.close()

        result['total_formulas'] = formula_count

        return result

    except Exception as e:
        return {'error': str(e)}


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 recalc.py <excel_file> [timeout_seconds]")
        print("\nRecalculates all formulas in an Excel file using LibreOffice")
        print("\nReturns JSON with error details:")
        print("  - status: 'success' or 'errors_found'")
        print("  - total_errors: Total number of Excel errors found")
        print("  - total_formulas: Number of formulas in the file")
        print("  - error_summary: Breakdown by error type with locations")
        print("    - #VALUE!, #DIV/0!, #REF!, #NAME?, #NULL!, #NUM!, #N/A")
        sys.exit(1)

    filename = sys.argv[1]
    timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    result = recalc(filename, timeout)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
