import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const path = "packages/ui/src/v4/SessionPane.tsx";
const source = ts.createSourceFile(
  path,
  await readFile(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function findOne(predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1);
  return matches[0];
}
function evaluate(node, dependencies) {
  const { outputText } = ts.transpileModule(`const result = ${node.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  });
  return new Function(...Object.keys(dependencies), `${outputText}; return result;`)(
    ...Object.values(dependencies),
  );
}
const forbiddenQuota = new Proxy(
  {},
  {
    get() {
      throw new Error("Official quota must not participate in session UI decisions");
    },
  },
);

test("session errors retain draft/send/control precedence without quota takeover", () => {
  const declaration = findOne(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "composerError",
  );
  const draft = { message: "Fixture model unavailable" },
    send = { message: "Fixture rejected command" },
    control = { code: "1005", message: "Fixture provider failure", traceId: "local-fixture-trace" };
  for (const [draftModelReadinessError, sendSubmissionError, projectedComposerError, expected] of [
    [draft, send, control, draft],
    [null, send, control, send],
    [null, null, control, control],
    [null, null, null, null],
  ]) {
    assert.equal(
      evaluate(declaration.initializer, {
        draftModelReadinessError,
        sendSubmissionError,
        projectedComposerError,
        quotaBanner: forbiddenQuota,
      }),
      expected,
    );
  }
});

test("composer retains connection/rebuild/queue edit gates without account quota reads", () => {
  const element = findOne(
    (node) =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "ConversationComposer",
  );
  const disabled = element.attributes.properties.find(
    (node) => ts.isJsxAttribute(node) && node.name.text === "disabled",
  );
  assert.ok(disabled && ts.isJsxExpression(disabled.initializer));
  for (const flags of [
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ]) {
    const [connecting, draftRuntimeRebuilding, queueEditActiveForCurrentComposer] = flags;
    assert.equal(
      evaluate(disabled.initializer.expression, {
        connecting,
        draftRuntimeRebuilding,
        queueEditActiveForCurrentComposer,
        quotaBanner: forbiddenQuota,
      }),
      flags.some(Boolean),
    );
  }
});

test("session shell no longer imports official quota or MCP-plan banner logic", () => {
  const imports = source.statements
    .filter(ts.isImportDeclaration)
    .map((node) => node.getText(source))
    .join("\n");
  assert.doesNotMatch(
    imports,
    /QuotaBanner|[Uu]sageEntitlement|mcpUnavailableBannerNotice|startPlanQuota/,
  );
});
