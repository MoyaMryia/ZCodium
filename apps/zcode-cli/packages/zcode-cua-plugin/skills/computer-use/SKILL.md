---
name: computer-use
description: "Read and drive a native desktop application through its own UI: accessibility tree, window screenshots, click, drag, scroll, type, paste, set field values, select text, and the actions an element advertises. Use when a task has to operate an app that exposes no API, CLI, connector or dedicated skill — filling a form in a desktop client, working a file manager, reading or dismissing a dialog, pulling text off a canvas or game surface — or when the user names a desktop app and asks you to do something inside it. Anything inside a web page belongs to Browser Use. Main agent only; the host bridge refuses a subagent outright. Native execution is supplied by the shared node_repl host, and the runtime behind that host is a fail-closed placeholder in this repository, so a call fails closed with a stated reason rather than moving a real pointer."
---

# Computer Use

Operate the user's desktop applications through their own UI. Everything below describes
what actually ships in this repository: the five modules in `scripts/` beside this file, and
the `node_repl` host that loads them. Where the chain stops, this page says so instead of
implying a capability that is not there.

## 1. Scope

|              |                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| In scope     | 14 tools behind `agent.computerUse.computer.*`, a bound-app object API, keyboard chord normalization, cold-start retry, broker error mapping |
| Out of scope | Browser control (Browser Use owns it), any command-line interface, and native pointer/keyboard execution                                     |

Three boundaries worth stating before anything else:

- **There is no CLI.** `scripts/computer-use-client.mjs` is a library module. Running it
  with `--help`, or with no arguments at all, prints nothing and exits `0`: it has no
  argument parser and no top-level side effects, so it is only ever reached through
  `await import(...)` from a `node_repl` cell. The one executable in the plugin is
  `node scripts/check-sdk.mjs` (`pnpm check:sdk`), which asserts the five modules exist and
  import cleanly.
- **There is no browser half.** No `browsers`, `getBrowser`, `createBrowserTab` or `getTab`;
  `State` carries no `browsers` key; the bound target is an app, never a tab.
- **Nothing moves a real pointer today.** See §11.

## 2. The five modules

The SDK used to be one 1208-line file. It is now five modules, all under `scripts/`:

| File                        | Lines | Responsibility                                                                                                      |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `computer-use-client.mjs`   | 340   | Assembly: `setupComputerUseRuntime`, app binding, the `computer.*` escape hatch, the `agent.documentation` hand-off |
| `computer-use-errors.mjs`   | 108   | `ComputerUseError`, the broker-code → SDK-code map, the retry policy                                                |
| `computer-use-envelope.mjs` | 416   | MCP result reading, cold-start retry, projection of results to the host                                             |
| `computer-use-target.mjs`   | 400   | The App/Window interaction surface and target resolution                                                            |
| `computer-use-keys.mjs`     | 71    | Keyboard chord normalization                                                                                        |

`check-sdk.mjs` (25 lines) is the smoke test across all five.

## 3. Where a call goes

```text
model cell
└─ scripts/computer-use-client.mjs          340 lines — model-visible surface
   │  globals[Symbol.for("zcode.node-repl.computer-use-bridge")]
   └─ node-repl-host/src/cua-bridge.ts      204 lines — host bridge
      │  one JSON line per request, over a socket or a named pipe
      └─ node-repl-host/src/cua-broker.ts   181 lines — host broker
         │  runtime.execute({toolName, arguments, context, signal})
         └─ @zcode/zcode-cua                runtime — fail-closed placeholder
            └─ ZCode Computer Use.app       Helper binary — absent
```

Each layer owns exactly one thing:

- **Model-visible surface** — turns JavaScript calls into tool calls, unwraps results,
  normalizes keys, decides retry. It never opens a socket.
- **Host bridge** — injects the bridge object under
  `Symbol.for("zcode.node-repl.computer-use-bridge")`, checks that the call belongs to a
  live generation and to a main-agent scope, carries the request context (session,
  workspace, trace), and captures the target app identity out of the response metadata.
- **Host broker** — owns the transport: a Unix socket or a Windows named pipe, a random
  32-byte token compared with `timingSafeEqual`, a 1 MiB request cap, id pairing, and
  abort propagation.
- **Runtime** — `createComputerUseRuntime()`. In this repository it is the placeholder in
  `packages/zcode-cua/index.js`.
- **Helper binary** — the signed macOS app that performs the native work. It is not in this
  repository and not in any official Linux package; it is not portable.

Bridge and broker exchange one JSON line each way, and that protocol is fixed:

```text
request   {"id":"<uuid>","token":"<32B hex>","method":"<name>","input":{…},"context":{…}}
response  {"id":"<uuid>","ok":true,"result":{…}}
          {"id":"<uuid>","ok":false,"error":"<message>"}
```

The broker injects `runtime` as an ordinary parameter and is indifferent to how it is
implemented, which is why the placeholder can be swapped without touching either side.

## 4. Bootstrap, every cell

`node_repl` runs each `js` call in a brand-new Worker. Globals, imports, the module cache
and every binding are gone by the next call, so a `const app` does not survive the end of
its cell. The UI state does survive — the host session holds it — which makes re-binding
cheap. Put the load and the actions in the **same** cell, load first:

```js
async function bindComputerUse() {
  const root =
    process.env.ZCODE_CUA_PLUGIN_ROOT ??
    process.env.ZCODE_PLUGIN_ROOT ??
    process.env.CLAUDE_PLUGIN_ROOT;
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const entry = join(root, "scripts", "computer-use-client.mjs");
  const sdk = await import(pathToFileURL(entry).href);
  await sdk.setupComputerUseRuntime({ globals: globalThis });
  return globalThis.agent.computerUse;
}

const cua = await bindComputerUse();
const settings = await cua.getApp("System Settings");
await settings.getAXState();
```

`ZCODE_PLUGIN_ROOT` is what the plugin MCP server injects; `ZCODE_CUA_PLUGIN_ROOT` is the
host's own override, and the value it uses to locate `docs/`; `CLAUDE_PLUGIN_ROOT` is the
legacy alias injected alongside the first. `join` is deliberate — the plugin root is an
arbitrary path on Windows too, so string concatenation is not safe here.

## 5. The bound API

`setupComputerUseRuntime({ globals })` mounts one object at `agent.computerUse` and returns
it. It throws a plain `Error` before that if the bridge is missing (§11).

| Member                         | Does                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getApp(target)`               | Binds an app. `target` is a display name, a bundle id, or `{name\|bundle_id\|pid}`. Launches the app when it is not running — there is no separate launch call. Displays nothing. |
| `getWindow(target, windowId)`  | The same binding pinned to one window. Non-enumerable, so it stays out of `Object.keys`: a named escape hatch, not part of the documented surface.                                |
| `getState(options?)`           | `{ apps }` — every app the host can see. Emits its own result.                                                                                                                    |
| `listApps(options?)`           | The `apps` array alone. Emits its own result.                                                                                                                                     |
| `requestAccess(capabilities?)` | Reports the current permission state. Reports only; it never escalates.                                                                                                           |
| `stop(reason?)`                | Releases computer control. Stop everything after this.                                                                                                                            |
| `computer`                     | Frozen object holding the 14 tools (§7).                                                                                                                                          |

A bound app carries twelve methods:

|                                                |                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `getAXState(options?)`                         | The accessibility tree as text. Emits it.                                                      |
| `getScreenshot(options?)`                      | One window's pixels as `Uint8Array`.                                                           |
| `getAXStateAndScreenshot(options?)`            | Both in one round trip; resolves to `{ state, screenshot? }`.                                  |
| `elements()`                                   | The element table as data. Silent — one round trip, nothing displayed.                         |
| `click(target, options?)`                      | An element index or a `[x, y]` pixel.                                                          |
| `drag(from, to, options?)`                     | Two targets.                                                                                   |
| `scroll(target, direction, pages?, options?)`  | Direction is `up\|down\|left\|right`, or the single letters `u\|d\|l\|r`. Pages defaults to 1. |
| `pressKey(key, options?)`                      | A key or a `+`-separated chord.                                                                |
| `typeText(text)`                               | Types into whatever holds keyboard focus in the bound app.                                     |
| `setValue(elementIndex, value)`                | Sets a field directly.                                                                         |
| `selectText(elementIndex, text, options?)`     | Locates text inside an editable element.                                                       |
| `paste(text, options?)`                        | Borrows the system pasteboard. `format` defaults to `text`.                                    |
| `performSecondaryAction(elementIndex, action)` | Runs an action the element advertises.                                                         |

Options are per method: `click` takes `mouseButton`, `clickCount`, `modifiers`, `strategy`;
`pressKey` takes `holdSeconds`, `strategy`; `selectText` takes `prefix`, `suffix`,
`selectionType`; `drag` takes `modifiers`; `scroll` takes `strategy`; `paste` takes `format`,
which defaults to `text`.

### Prefer the element path

Accessibility is the primary path: it is semantic and precise, and it does not depend on
window geometry the way a coordinate does. In order:

1. `getAXState()`, then find the target in the tree by role, name, title or value.
2. Act on it by **index**. For a control that advertises a semantic action,
   `performSecondaryAction` is also correct.
3. For a settable field prefer `setValue` over typing or pasting. Reach for `paste` only
   when the target is not settable or the content is rich text.
4. Keyboard is the fallback — `pressKey` only when no element expresses the operation, or
   the user asked for keyboard interaction.
5. Coordinates are the last resort: canvas, games, and Electron content accessibility
   cannot see.

Do not swap an available element action for a keyboard shortcut because the shortcut is
shorter, and do not run both the accessibility and the visual path for one action.

The element path is also the one that does not need a window fronted, which is why it
outranks coordinates. Success means the API accepted an action, not that the app acted:
typing into a web-content editor can be accepted and change nothing, so re-observe to confirm
the text landed.

## 6. Targets

`target` is either an element index or a raster pixel:

- **A number** — a non-negative integer addressing that app's most recent observation.
  Acting on an index with no observation behind it fails closed with `STALE_STATE` and tells
  you to call `getAXState()` first, rather than observing on your behalf and risking a click
  somewhere you did not choose.
- **`[x, y]`** — two non-negative integers, pixels of the **latest returned raster**. The SDK
  binds the raster internally and owns every transform from that raster to native dispatch,
  so you never handle a frame id. Element and window bounds in the tree are diagnostic global
  screen points and must never be copied into a coordinate.

Indices are renumbered by every observation, so take them from the newest tree. A tree is
sent whole whenever the model has not already seen the baseline, and as a diff afterwards:
`getAXState` sets `disable_diffing` while the previous tree was never displayed, and a
screenshot-only observation marks the baseline unseen so the next tree is whole again.
`{ disableDiffing: true }` forces a whole tree at any point. `elements()` returns the element
table as data — the rows the latest observation exposed — so filter it in JS rather than
guessing an index:

```js
const rows = await prefs.elements();
const at = rows.findIndex((row) => typeof row.value === "string" && row.value === "");
if (at >= 0) await prefs.setValue(at, "Notifications");
await prefs.pressKey("Return");
await prefs.getAXState({ disableDiffing: true });
```

## 7. The 14 tools

`agent.computerUse.computer` is the low-level surface, and it is frozen. Prefer the bound
API; reach for a tool only for what the bound API does not express — window enumeration, key
repeat, or reading state back in the same call. Each tool takes **one** arguments object
whose keys are validated strictly: an undeclared key is refused, and a missing required key
is reported against that field.

| Tool                    | Arguments                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `list_apps`             | `{}`                                                                                             |
| `list_windows`          | `{app_ref}`                                                                                      |
| `get_app_state`         | `{app_ref, include_screenshot?=false, disable_diffing?=false}`                                   |
| `left_click`            | `{target, mouse_button?="left", click_count?=1, modifiers?, strategy?, app_ref?, return_state?}` |
| `left_click_drag`       | `{from_target, to, modifiers?, app_ref?, return_state?}`                                         |
| `scroll`                | `{target, scroll_direction, scroll_amount, strategy?, app_ref?, return_state?}`                  |
| `type`                  | `{text, target?, app_ref?, strategy?, return_state?}`                                            |
| `set_value`             | `{target, value, strategy?, app_ref?, return_state?}`                                            |
| `select_text`           | `{target, text_range?, app_ref?, return_state?}`                                                 |
| `key`                   | `{text, repeat?, hold_seconds?, app_ref?, strategy?, return_state?}`                             |
| `paste`                 | `{text, format?="text", app_ref?, return_state?}`                                                |
| `perform_action`        | `{target, action, app_ref?, return_state?}`                                                      |
| `request_access`        | `{capabilities?}`                                                                                |
| `stop_computer_control` | `{reason?}`                                                                                      |

`app_ref` is `{name}` for a display name, `{bundle_id}` for an identifier, or `{pid}`; add
`window_id` to pin one window. A bare string is read as a **bundle id**, so pass
`{name: "Notes"}` for a display name. `scroll_direction` is `up|down|left|right` and
`scroll_amount` is pages, defaulting to 1. `strategy`, `return_state`, `modifiers`, `repeat`,
`hold_seconds` and `format` are forwarded to the tool verbatim — the SDK does not validate
them, so their accepted values are whatever the host's tool manifest declares. The broker
reports `foreground_required`, which the SDK surfaces as `FOREGROUND_REQUIRED`; nothing is
sent when that happens.

`computer.target` reports the platform as `"mac"`, `"windows"` or `"linux"`. The
platform-exclusion table that would shrink the tool list per platform is currently empty on
every platform, so all 14 are present everywhere; the mechanism is there for the first
platform-specific tool.

## 8. Results

A tool call returns one of three shapes, because the SDK unwraps exactly one case:

- **The parsed payload** — a result with a single text block is `JSON.parse`d for you.
  `list_apps` and `list_windows` land here.
- **A plain string** — that same single text block when it is not JSON. `get_app_state`
  without a screenshot lands here: you get the rendered tree, and the `structuredContent`
  that carried `state_id` and the element rows does not survive the unwrap. Use `elements()`
  for that table.
- **The raw MCP envelope** — `{ content: [...] }`, returned unchanged for anything else,
  most often because `include_screenshot: true` added an image block.

Branch on the shape instead of assuming one:

```js
const listed = await cua.computer.list_windows({ app_ref: { name: "Notes" } });
nodeRepl.write(`windows: ${JSON.stringify(listed)}`);

const shot = await cua.computer.get_app_state({
  app_ref: { name: "Notes" },
  include_screenshot: true,
});
const raster = shot.content?.find((block) => block.type === "image");
nodeRepl.write(`raster present: ${Boolean(raster)}`);
```

Observations display themselves. `getAXState`, `getAXStateAndScreenshot`, `getState` and
`listApps` write their own text through `nodeRepl.write`, and `{ emit: false }` suppresses
that while still returning the value. Images and the frame-authority block travel
separately, through `nodeRepl.emitStructuredResult`; `getScreenshot` writes no text at all.
Do not feed an observation's return value back into `nodeRepl.write` — the host keeps one
raster per result, and a second one drops the frame entirely, leaving no picture. Action
methods display nothing and resolve to `undefined` on success.

## 9. Failures, retry, and stopping

An action resolves to `undefined` on success and throws `ComputerUseError` otherwise. The
error carries three fields you act on:

- `code` — see the two tables below.
- `actionSent` — whether the action may already have reached the app. It defaults to `false`
  and is only set `true` when the broker reports it, so a `false` never blocks a retry.
- `retry` — `"reobserve"`, `"retry"` or `"never"`, derived from `actionSent` first and the
  code second. A possibly-landed non-idempotent action is always `"reobserve"`, even when the
  code looks harmless, so a blind retry cannot turn one click into two.

| Broker reports        | SDK code              |
| --------------------- | --------------------- |
| `permission_denied`   | `PERMISSION_DENIED`   |
| `not_authorized`      | `NOT_AUTHORIZED`      |
| `launch_failed`       | `LAUNCH_FAILED`       |
| `invalid_request`     | `INVALID_APP`         |
| `element_unavailable` | `ELEMENT_UNAVAILABLE` |
| `not_settable`        | `NOT_SETTABLE`        |
| `not_selectable`      | `NOT_SELECTABLE`      |
| `action_unavailable`  | `ACTION_UNAVAILABLE`  |
| `foreground_required` | `FOREGROUND_REQUIRED` |
| `controller_busy`     | `CONTROLLER_BUSY`     |
| `broker_unavailable`  | `HELPER_UNAVAILABLE`  |
| `stale_socket`        | `HELPER_UNAVAILABLE`  |
| `version_mismatch`    | `VERSION_MISMATCH`    |
| `timeout`             | `TIMEOUT`             |
| `unimplemented`       | `ACTION_UNAVAILABLE`  |
| `method_not_found`    | `INTERNAL`            |
| `internal`            | `INTERNAL`            |
| anything unregistered | `INTERNAL`            |

The SDK raises these itself, before or after the broker is involved:

| Code                           | Raised when                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `INVALID_APP`                  | `getApp` gets something that is neither a non-empty string nor `{name\|bundle_id\|pid}`                           |
| `STALE_STATE`                  | an element index arrives with no observation behind it, or a pinned `window_id` fell back to the frontmost window |
| `STRUCTURED_STATE_UNAVAILABLE` | an observation came back missing `state_id`, `elements`, `app` or `window`                                        |
| `NOT_SELECTABLE`               | `selectText` cannot locate its text, or the match is ambiguous                                                    |
| `ACTION_UNAVAILABLE`           | `performSecondaryAction` is asked for an action the element does not advertise                                    |
| `ELEMENT_UNAVAILABLE`          | pixels were requested and none came back                                                                          |
| `TIMEOUT`                      | a `possibly_sent` dispatch reported success, or a retryable cold start exhausted its attempts                     |
| `CONTROLLER_BUSY`              | the broker reports `controller_busy`, or a not-ready envelope is not retryable                                    |
| `INTERNAL`                     | a malformed target, key, direction, button or text argument                                                       |

`CONTROLLER_BUSY` is never retryable: report the owner from the error and ask the user to
close that session. Stop immediately after `stop()`, a kill switch, a permission refusal, or
a non-retryable error, and do not switch to a different UI-automation technology after an
access refusal. Four names from the wider upstream surface — `APP_NOT_FOUND`,
`AMBIGUOUS_APP`, `CONTROL_STOPPED`, `SCREEN_LOCKED` — are not raised by any path in these
five modules, so do not branch on them.

```js
try {
  await sheet.setValue(14, "Q3 revenue");
} catch (error) {
  if (error.name !== "ComputerUseError") throw error;
  nodeRepl.write(`code=${error.code} retry=${error.retry} sent=${error.actionSent}`);
  if (error.retry === "reobserve") {
    await sheet.getAXState({ disableDiffing: true }); // may already have landed
  } else if (error.retry === "never") {
    nodeRepl.write(error.message);
  } else {
    await sheet.setValue(14, "Q3 revenue");
  }
}
```

### Cold start

The Helper starts lazily. A call that arrives while it is still coming up returns a
non-error envelope with `kind: "CUA_NOT_READY"`, and the SDK retries the **same** call up to
6 attempts with a 250 / 500 / 750 / 1000 / 1500 ms backoff. Only `retryable` envelopes are
retried — a `possibly_sent` action is never replayed. When the attempts run out the error is
`TIMEOUT`; a non-retryable not-ready is `CONTROLLER_BUSY`. Either way the producer's own
message and `reasonCode` reach the error instead of a generic sentence.

## 10. Keyboard

`pressKey` takes a key or a `+`-separated chord and accepts both short names and X keysym
spellings. `computer-use-keys.mjs` normalizes the input side only: it accepts the common
spellings, emits the internal token, and passes anything unrecognized through unchanged — a
key name can carry case (`F5`) or be broker-private, and rewriting it would break more than
it fixes.

| Internal token          | Also accepted                                           |
| ----------------------- | ------------------------------------------------------- |
| `return`                | `enter`, `kp_enter`                                     |
| `ctrl`                  | `control_l`, `control_r`, `control`                     |
| `alt`                   | `alt_l`, `alt_r`, `meta_l` (macOS Option), `alt`        |
| `shift`                 | `shift_l`, `shift_r`                                    |
| `esc`                   | `escape`                                                |
| `pageup`                | `prior`                                                 |
| `pagedown`              | `next`                                                  |
| `.` `,` `>` `/` `-` `=` | `period`, `comma`, `greater`, `slash`, `minus`, `equal` |

`super` is the one group that forks on platform: `cmd` on macOS, `win` on Windows, and
`super` elsewhere for the broker to interpret. Bind keyboard input to an app or element —
never send it unbound. `selectText` uses `prefix`/`suffix` to disambiguate repeated matches
and `selectionType` (`text`, `cursor_before`, `cursor_after`) to place the cursor instead of
selecting; an ambiguous match is refused rather than resolved to the first hit.

## 11. Availability, stated plainly

`packages/zcode-cua/index.js` is a fail-closed placeholder, not a runtime. Its `execute()`
always answers `Computer Use is not available in this build.` with `isError: true`, and
`closeSession` / `dispose` do nothing. What that means in practice:

- The host only creates a broker when it finds a runtime, and it only finds one when
  `ZCODE_CUA_PERMISSION_BROKER_SOCKET` is set. With no broker, `bridge.assertAvailable()`
  throws before any tool call, and `setupComputerUseRuntime` refuses to assemble at all:
  _Computer Use runtime bridge is unavailable. Use Computer Use from a ZCode desktop or
  shared-host session._
- A subagent scope is refused at the bridge with _Computer Use is not available in
  subagent_. Main agent only.
- A binding whose generation no longer matches the live kernel is refused as stale.
- **The Helper starts lazily** (see "Cold start" below), and the SDK absorbs that for you.
- The Helper binary that would do the native work does not exist here. It is a bundled
  macOS-only artifact, and it additionally requires a build identity injected as
  `__ZCODE_CUA_HELPER_BUILD_ID__` by the `node-repl-host` build — which that build script
  refuses to leave unset when it is supposed to be set. None of those conditions is
  satisfiable in this repository.

So treat a Computer Use call as one that fails closed with a stated reason, not as one that
drives the desktop. Everything above is the contract a real runtime plugs into; it is
written down so that when that runtime exists, none of this page has to change.

## 12. Pitfalls

- **Every cell needs the bootstrap.** There is no persistent `const app`.
- **`getApp` binds and shows nothing.** Call `getAXState()` when you need to see the state.
- **Copy the app name character for character.** Do not translate, localize, normalize,
  shorten or drop a suffix; a rewritten name resolves to a different app or to nothing. If
  the exact string does not resolve, call `listApps()` once and pick the identifier it
  returns.
- **A dotted, space-free string is sent as `bundle_id`, anything else as `name`**, and the
  other field is tried exactly once when the app is reported not running. Pass an object when
  you know which field you mean.
- **`window_id` is the only window pin.** Without it, which window is captured is re-resolved
  per observation rather than pinned, so a dialog that opened since the last observation can
  become the captured one. When an action fails unexpectedly or the tree reads like another
  part of the app, read the observation's `window` block first.
- **Never move, resize or close a window** to make a coordinate land.
- **A pointer action accepted with no visible change** usually means the app acted where the
  real pointer sits; repeating it will not help — use an element index or the keyboard.
- **Do not pause before observing.** No `setTimeout`, no polling loop; observations wait for
  the UI to settle themselves.
- **Attempting an action is not completion.** Verify that the returned state visibly shows
  the result before responding.
