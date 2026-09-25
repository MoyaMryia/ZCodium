import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Run the actual component callback with explicit boundary dependencies. This avoids
// copying submission logic into tests or exporting private handlers in product code.
export async function loadComponentCallback(path, name, dependencies) {
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      const value = node.initializer;
      const callback =
        value && ts.isCallExpression(value) && value.expression.getText(source) === "useCallback"
          ? value.arguments[0]
          : value;
      assert.ok(
        callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)),
        name,
      );
      matches.push(callback.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `Expected one production callback: ${name}`);
  const { outputText } = ts.transpileModule(`const callback = ${matches[0]};`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  return new Function(...Object.keys(dependencies), `${outputText}\nreturn callback;`)(
    ...Object.values(dependencies),
  );
}
