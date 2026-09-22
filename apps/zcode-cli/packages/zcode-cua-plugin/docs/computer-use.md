# Computer Use — execution chain reference

This file is the on-demand reference for Computer Use. The SDK serves it verbatim through
`agent.documentation.get("computer-use")`, which reads
`join(bridge.documentationRoot, "computer-use.md")`; the host resolves that root from
`ZCODE_CUA_PLUGIN_ROOT` (falling back to `ZCODE_PLUGIN_ROOT`, then the working directory)
plus `docs`.

`OFFICIAL_CUA_REQUIRED_SEED_PATHS` pins seven paths for this plugin: this file, the five
SDK modules, and `skills/computer-use/SKILL.md`. A seed that drops any of them fails loudly
instead of installing a plugin whose documentation call or first tool call cannot resolve.

The resident skill page is the short version. This document is the long one: it covers the
five modules and their exports, the five layers a call crosses, the platform differences, the
result-reading rules, and the error model in full.

## 1. The five modules

| File                                | Lines | Responsibility                                                                                                      |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `scripts/computer-use-client.mjs`   | 340   | Assembly: `setupComputerUseRuntime`, app binding, the `computer.*` escape hatch, the `agent.documentation` hand-off |
| `scripts/computer-use-errors.mjs`   | 108   | Error object, broker-code mapping, retry policy                                                                     |
| `scripts/computer-use-envelope.mjs` | 416   | MCP result reading, cold-start retry, projection to the host                                                        |
| `scripts/computer-use-target.mjs`   | 400   | App/Window interaction surface and target resolution                                                                |
| `scripts/computer-use-keys.mjs`     | 71    | Keyboard input-side normalization                                                                                   |
| `scripts/check-sdk.mjs`             | 25    | Smoke test: every module exists and the entry imports cleanly                                                       |

The dependency direction is one-way and acyclic — each module imports only from modules below
it in this list:

```text
client   ──▶ errors, envelope, target, keys
target   ──▶ errors, envelope, keys
envelope ──▶ errors
keys     ──▶ (nothing)
errors   ──▶ (nothing)
```

`client` is the only module the outside world imports, and nothing imports `client`, which is
what keeps the cycle out. `errors` is a leaf; `envelope` sits on it; `target` sits on both plus
`keys`.

### `computer-use-client.mjs` — assembly (340 lines)

Exports six names:

| Export                                 | What it is                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setupComputerUseRuntime({ globals })` | Async factory. Reads the bridge out of `globals`, builds the invoker, and returns the `cua` object after mounting it at `globals.agent.computerUse`.               |
| `BRIDGE_SYMBOL`                        | `Symbol.for("zcode.node-repl.computer-use-bridge")`. The injection point is a registered symbol so the bridge and the SDK agree without sharing a module instance. |
| `COMPUTER_METHOD_NAMES`                | The 14 tool names, frozen.                                                                                                                                         |
| `PLATFORM_EXCLUDED_METHODS`            | Per-platform tool removal table. Currently `{}` on every platform.                                                                                                 |
| `ComputerUseError`                     | Re-exported so a caller that imports only the entry still gets the type.                                                                                           |
| `normalizeKeyChord`                    | Re-exported for the same reason.                                                                                                                                   |

Behaviour worth knowing:

- **The bridge is mandatory.** A missing or malformed bridge, or a failing
  `bridge.assertAvailable()`, throws a plain `Error` — not a `ComputerUseError` — before
  anything is mounted.
- **Binding is observing.** `getApp` runs one full `get_app_state` with
  `include_screenshot: false`, `disable_diffing: true`, `tree_shown_to_model: false`. That
  observation resolves identity, validates the window pin, and seeds the index baseline, but
  it is deliberately not displayed: every cell re-binds, so displaying it would spend a whole
  tree per cell on a tree that is stale by the time the cell ends.
- **Identity converges.** After a successful bind, `app_ref` is rebuilt from the observed
  `pid` and `bundle_id` (keeping `window_id` when it was pinned). Observation is lenient — a
  localized name can resolve through the host's own lookup — while input is strict, so a name
  that observed fine would otherwise fail on the very next `pressKey`.
- **Window pins fail closed.** When `window_id` was requested and the observation reports
  `window_id_fallback: true`, binding throws `STALE_STATE` naming the window and pointing at
  `list_windows`. A silent fallback to the frontmost window would leave the model operating
  the wrong one.
- **`computer` is frozen**, and `computer.target` is `"mac"` on `darwin`, `"windows"` on
  `win32`, `"linux"` otherwise.
- **`elements` and `getWindow` are non-enumerable.** They are named escape hatches; keeping
  them out of `Object.keys` preserves the documented enumerable surface while still allowing
  a caller that knows the name to use it.
- **`agent.documentation` is wrapped, not replaced.** A request for `computer-use` reads this
  file from `bridge.documentationRoot`; any other name is forwarded to the previous loader
  when one exists, and otherwise rejected with `Unknown documentation entry: <name>`.

### `computer-use-errors.mjs` — failure semantics (108 lines)

| Export                                | What it is                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `BROKER_CODE_TO_SDK_CODE`             | 17 broker codes mapped onto 14 SDK codes. Anything unregistered lands on `INTERNAL` by design.                                |
| `REACQUIRE_FIRST_CODES`               | `ELEMENT_UNAVAILABLE`, `STALE_STATE`, `STRUCTURED_STATE_UNAVAILABLE` — the UI probably moved, so re-observe before resending. |
| `POINTLESS_RETRY_CODES`               | Eight codes where a retry only amplifies the side effect.                                                                     |
| `decideRetryPolicy(actionSent, code)` | Returns `"reobserve"`, `"never"` or `"retry"`. `actionSent` is checked first and wins outright.                               |
| `ComputerUseError`                    | `Error` subclass carrying `code`, `actionSent`, optional `dispatchStatus`, frozen `details`, and a precomputed `retry`.       |

`actionSent` defaults to `false` and is only ever set `true` when the broker says so. The
reverse default would make a recoverable blip permanent.

### `computer-use-envelope.mjs` — result reading (416 lines)

Sixteen exports, in two groups.

Reading a result:

| Export                                | What it does                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectTexts(result)`                | Every `type: "text"` block's text, in order.                                                                                                                                                                                                                                                               |
| `parseJsonObject(text)`               | `JSON.parse` that rejects arrays — for positions expecting a record.                                                                                                                                                                                                                                       |
| `parseJsonAny(text)`                  | `JSON.parse` that accepts any value, because `list_apps` returns a bare array.                                                                                                                                                                                                                             |
| `readReceipt(result)`                 | Merges `state_id`, `frame_id`, `action_sent`, `dispatch_status`, `state_sync_status`, `code`, `reason`, `snapshot_mode`, `base_state_id` from three sources: the envelope top level, `structuredContent`, and the JSON text blocks including their `action_outcome` nesting. First sighting of a key wins. |
| `readFrameId(result, receipt)`        | `receipt.frame_id`, else `image_ref.frame_id` inside a JSON text block — the frame authority is signed next to the image, not at the top level.                                                                                                                                                            |
| `readMessage(result, fallback)`       | The producer's own `message`, else the first non-JSON text, else the first text block, else the caller's fallback.                                                                                                                                                                                         |
| `readImageBytes(result)`              | Base64 `image` block decoded to `Uint8Array`, or `undefined`.                                                                                                                                                                                                                                              |
| `readAdvisoryTexts(result, treeText)` | The producer's informational blocks (`[effect_evidence unchanged]`, `[screenshot_blank]`), excluding the tree text, the JSON blocks and the frame-authority block.                                                                                                                                         |
| `isFrameAuthorityText(value)`         | True for a JSON object whose only key is `image_ref`.                                                                                                                                                                                                                                                      |
| `readNotReady(result)`                | The `kind: "CUA_NOT_READY"` record, and only on a non-error result.                                                                                                                                                                                                                                        |
| `readAppState(methodName, result)`    | The structured observation. Requires a string `state_id`, an array `elements`, and both `app` and `window`; anything missing throws `STRUCTURED_STATE_UNAVAILABLE` naming exactly what was absent.                                                                                                         |
| `assertUsable(methodName, result)`    | The single success/failure gate. Returns the receipt on success; throws on `isError` or on a `possibly_sent` dispatch.                                                                                                                                                                                     |

Two helpers stay internal: `collectJsonRecords` (the object-shaped JSON blocks that
`readReceipt`, `readMessage` and `readNotReady` all walk) and `readBrokerCode` (the broker's
`code`, read from a JSON record or from the receipt).

Projecting to the host:

| Export                               | What it does                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectToHost(globals, result)`     | Sends image blocks and the frame-authority block to `nodeRepl.emitStructuredResult`, an error result unchanged, and otherwise the `structuredContent` plus `_meta` with an empty content array. |
| `stripForDisplay(structured)`        | Replaces the `elements` array with `element_count` and drops `text`. A single observation of a large app can carry 140 KB of element rows that the model has already read as rendered tree.     |
| `emitToRepl(globals, text, options)` | `nodeRepl.write`, suppressed by `{ emit: false }`, with failures swallowed — display is a side effect and must not fail the call.                                                               |
| `createInvoker(bridge, globals)`     | Wraps call + cold-start retry + projection into one function. See §6.                                                                                                                           |

### `computer-use-target.mjs` — interaction surface (400 lines)

| Export                                                  | What it does                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createAppTarget(ctx, binding)`                         | Builds the twelve-method bound object for one app.                                                                                                                                                                             |
| `createBinding(label, appRef)`                          | The per-target view: `label`, `appRef`, `stateId`, `frameId`, `elements`, `treeSeen`. The cross-cell truth lives in the host session, not here.                                                                                |
| `resolveTarget(binding, target, what)`                  | A number becomes `{type: "element", index}` and requires a `stateId`; `[x, y]` becomes `{type: "coordinate", frame_id?, x, y}`. Anything else is refused.                                                                      |
| `buildAppRef(value, windowId)`                          | A string containing a dot and no whitespace or slash becomes `bundle_id`; everything else becomes `name`.                                                                                                                      |
| `buildAlternateAppRef(value, windowId)`                 | The opposite field, used for exactly one retry.                                                                                                                                                                                |
| `isAppUnresolved(result)`                               | Detects the "target app is not running" signal so the alternate field is tried.                                                                                                                                                |
| `locateTextRange(binding, elementIndex, text, options)` | Computes `[start, length]` locally from the observed element `value`, using `prefix`/`suffix` to disambiguate and `selectionType` to fold the selection into a cursor. Ambiguity throws `NOT_SELECTABLE` with the match count. |

Two decisions in this module are worth knowing because they look like omissions:

- **Actions do not clear `stateId`.** The guard that used to invalidate the index after every
  action fought the documented action pattern (click an index, then type into it, in one
  cell) and had no evidence behind it: the SDK knows an action happened, not whether the UI
  changed. The real check is the frozen index-to-native-token mapping on the producer side,
  which already fails closed when an element disappears.
- **A coordinate without a local frame is allowed.** The tool layer permits omitting
  `frame_id`, and the implicit path binds the session's most recent actionable raster. The
  fail-closed properties are unchanged: an expired, replaced, non-actionable frame, or a
  frame whose owner is not this `app_ref`, is still refused.

### `computer-use-keys.mjs` — keyboard normalization (71 lines)

One export, `normalizeKeyChord(chord, platform)`: splits on `+`, maps each segment through a
canonical spelling table, drops empty segments, and rejoins. `super`, `super_l` and
`super_r` are the only spellings that fork on platform — `cmd` on `darwin`, `win` on
`win32`, `super` elsewhere. Unregistered spellings pass through untouched.

## 2. The five layers a call crosses

```text
model cell
└─ scripts/computer-use-client.mjs            340 lines — model-visible surface
   │  globals[Symbol.for("zcode.node-repl.computer-use-bridge")]
   └─ node-repl-host/src/cua-bridge.ts        204 lines — host bridge
      │  one JSON line per request, over a socket or a named pipe
      └─ node-repl-host/src/cua-broker.ts     181 lines — host broker
         │  runtime.execute({toolName, arguments, context, signal})
         └─ @zcode/zcode-cua                  FAIL-CLOSED PLACEHOLDER here
            └─ ZCode Computer Use.app         Helper binary — absent, macOS-only
```

### Layer 1 — model-visible surface

Owns everything the model can see: the bound-app API, the 14-tool escape hatch, envelope
unwrapping, key normalization, and the retry decision. It caches only what a binding needs
to address the current observation — `stateId`, `frameId` and the element table — and never
a window list, a coordinate or a clipboard value: window-id semantics differ per platform, so
a cached value goes stale silently.

It also owns the documentation hand-off: `agent.documentation.get("computer-use")` reads this
file, and any other name is forwarded to the loader that was there before.

### Layer 2 — host bridge

`createComputerUseBridgeGlobals` produces a single object under the registered symbol with
three members: `call(method, input)`, `assertAvailable()` and `documentationRoot`. What it
enforces:

| Guard                                       | Refusal                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| Call does not belong to the live generation | `Computer Use runtime binding is stale after kernel reset` |
| `runtime_scope` is `subagent`               | `Computer Use is not available in subagent`                |
| No broker connection for this session       | `Computer Use is unavailable for this node_repl session`   |
| Response exceeds 32 MiB                     | `Computer Use broker response exceeded the 32 MiB limit`   |
| Response id does not match the request id   | `Computer Use broker response id mismatch`                 |
| Broker answers `ok: false`                  | the broker's own error text                                |
| Socket closes before a response             | `Computer Use broker closed before returning a response`   |

The request context is assembled here and carries `runtimeScope`, `sessionId`,
`workspacePath`, `workspaceIdentity`, `workspaceKey`, optional `remoteSessionId`, `turnId`,
`clientMode`, `deliveryKind` and the trace triple. Both `session_id` and a workspace key are
mandatory — a request missing either is refused rather than sent unidentifiable.

Target-app identity is captured **here**, not downstream: the bridge reads the `primary`
association out of the response `_meta` and records it on the session. Waiting until
`projectToHost` would put that data on the model-writable channel, where producer-supplied
and cell-authored values could no longer be told apart.

### Layer 3 — host broker

Owns the transport and nothing else. Per connection: one line of JSON in, one line out, a
fresh random UUID as the request id, and a random 32-byte token compared with
`timingSafeEqual`. The socket is a Unix domain socket under `tmpdir()` (`znrc-<uuid>.sock`) on
every platform except Windows, where it is a `\\\\.\pipe\zcode-node-repl-cua-<uuid>` named
pipe; the file socket is removed on close, the pipe is not.

Limits: 1 MiB per request, and the socket is aborted as soon as the peer disconnects or the
call's signal fires, so an abandoned call stops consuming the runtime.

The broker calls `runtime.execute({ toolName, arguments, context, signal })`. It treats the
runtime as an opaque parameter, which is precisely why swapping the placeholder for a real
implementation touches neither the bridge nor the broker.

### Layer 4 — runtime

`packages/zcode-cua/index.js` is 335 bytes and fails closed on purpose:

```js
const UNAVAILABLE_TEXT = "Computer Use is not available in this build.";

export function createComputerUseRuntime(_options) {
  return {
    async execute() {
      return {
        content: [{ type: "text", text: UNAVAILABLE_TEXT }],
        isError: true,
      };
    },
    async closeSession() {},
    async dispose() {},
  };
}
```

The host only builds a broker when it finds a runtime at all, and it finds one only when
`ZCODE_CUA_PERMISSION_BROKER_SOCKET` is set (`captureComputerUseRuntimeFromEnvironment`). So
in a build without that variable there is no broker, and the bridge refuses every call before
a tool name is ever sent.

### Layer 5 — the Helper binary, and why it is absent

The native work belongs to `ZCode Computer Use.app`, a signed macOS-only bundle. Three
independent constraints keep it out of this repository:

1. **macOS only.** The install plan throws `install_failed` on any other platform, so
   importing it here would produce a guaranteed failure rather than a working plugin.
2. **Bundled, not downloadable.** The plan resolves to `{ kind: "bundled", appPath }`, and no
   official Linux package ships that `.app`.
3. **Requires a pinned build identity.** An empty `ZCODE_CUA_HELPER_BUILD_ID` is refused
   outright — _"Packaged ZCode is missing its embedded Computer Use Helper build identity;
   refusing an unpinned Helper install"_. The value is injected as the esbuild `define`
   `__ZCODE_CUA_HELPER_BUILD_ID__` by `node-repl-host/scripts/build.mjs`, sourced from
   `process.env.ZCODE_CUA_HELPER_BUILD_ID?.trim() ?? ""`, and the build fails if the id was
   supposed to be present but did not fold into the bundle.

A placeholder that says "unavailable" is more honest than a stack that cannot run.

## 3. Platform differences

|                         | Linux / macOS                                        | Windows                                            |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Broker socket           | Unix domain socket, `znrc-<uuid>.sock` in `tmpdir()` | Named pipe `\\\\.\pipe\zcode-node-repl-cua-<uuid>` |
| Socket cleanup on close | removed                                              | not removed                                        |
| `computer.target`       | `"linux"` or `"mac"`                                 | `"windows"`                                        |
| `super*` in a chord     | `super` (`cmd` on macOS)                             | `win`                                              |
| Platform-excluded tools | none                                                 | none                                               |
| Helper install plan     | not supported                                        | not supported                                      |
| Native execution        | placeholder                                          | placeholder                                        |

The tool list is identical on all three platforms today. `PLATFORM_EXCLUDED_METHODS` exists so
the first platform-specific tool has somewhere to go; until then it is empty, and the host's
manifest and the SDK's tool table are kept in agreement so the model never sees a method that
fails on call.

## 4. The 14 tools

`COMPUTER_METHOD_NAMES` is the frozen list, and every name on it becomes an enumerable member
of `agent.computerUse.computer`. Each takes **one** arguments object; the names below are its
keys, not positional parameters. The host's manifest validates them strictly, so an undeclared
key is refused rather than ignored.

| Tool                    | Arguments                                                                                        | Notes                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_apps`             | `{}`                                                                                             | The only tool with no arguments at all.                                                                                                        |
| `list_windows`          | `{app_ref}`                                                                                      | Window enumeration — not expressible through the bound API.                                                                                    |
| `get_app_state`         | `{app_ref, include_screenshot?=false, disable_diffing?=false}`                                   | The single observation primitive; everything else is layered on it. Both flags are host-declared; the bound API always passes them explicitly. |
| `left_click`            | `{target, mouse_button?="left", click_count?=1, modifiers?, strategy?, app_ref?, return_state?}` | `mouse_button` also accepts `l`/`r`/`m`.                                                                                                       |
| `left_click_drag`       | `{from_target, to, modifiers?, app_ref?, return_state?}`                                         |                                                                                                                                                |
| `scroll`                | `{target, scroll_direction, scroll_amount, strategy?, app_ref?, return_state?}`                  | `scroll_direction` also accepts `u`/`d`/`l`/`r`; `scroll_amount` is in pages.                                                                  |
| `type`                  | `{text, target?, app_ref?, strategy?, return_state?}`                                            | `target` optional — omit it to type at the current focus.                                                                                      |
| `set_value`             | `{target, value, strategy?, app_ref?, return_state?}`                                            |                                                                                                                                                |
| `select_text`           | `{target, text_range?, app_ref?, return_state?}`                                                 | `text_range` is `[start, length]`; omit it to select the whole value.                                                                          |
| `key`                   | `{text, repeat?, hold_seconds?, app_ref?, strategy?, return_state?}`                             | `repeat` re-sends the chord — use it instead of a loop.                                                                                        |
| `paste`                 | `{text, format?="text", app_ref?, return_state?}`                                                | Borrows the system pasteboard.                                                                                                                 |
| `perform_action`        | `{target, action, app_ref?, return_state?}`                                                      | `action` must be one the element advertises.                                                                                                   |
| `request_access`        | `{capabilities?}`                                                                                | Reports permission state; never escalates.                                                                                                     |
| `stop_computer_control` | `{reason?}`                                                                                      | Releases control.                                                                                                                              |

`app_ref` is `{name}` for a display name, `{bundle_id}` for an identifier, or `{pid}`, plus an
optional `window_id` to pin one window. A bare string is read as a **bundle id** — a string
containing a dot and no whitespace or slash is sent as `bundle_id`, anything else as `name`,
and the other field is tried exactly once when the host reports the app is not running.

`strategy`, `return_state`, `modifiers`, `repeat`, `hold_seconds` and `format` are forwarded
verbatim: this SDK does not validate them, so their accepted values are whatever the host's
tool manifest declares. The SDK does normalize `scroll_direction` (`u`/`d`/`l`/`r` expand to
the long form), `mouse_button` (`l`/`r`/`m` expand), and `key.text` (see §1,
`computer-use-keys.mjs`).

## 5. Result shapes

`computer.<tool>` returns one of three things, decided by a single unwrap rule in
`computer-use-client.mjs`: a result is unwrapped only when it has exactly one content block
and that block is text.

| Shape            | When                                                 | What you get                                                                                                                               |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Parsed payload   | exactly one text block, valid JSON                   | the tool's own shape; `list_apps` and `list_windows` land here                                                                             |
| Plain string     | exactly one text block, not JSON                     | the rendered tree for a screenshot-free `get_app_state`; the `structuredContent` with `state_id` and the element rows does **not** survive |
| Raw MCP envelope | anything else, most often `include_screenshot: true` | `{ content: [...] }`, including host-only fields this contract does not cover                                                              |

The reason the unwrap exists: without it the model receives
`{content:[{type:"text",text:"[…]"}],_meta:{…}}` and has to `JSON.parse` it by hand, while
`_meta` — which is host-only by design — leaks into the model's view. Unwrapping only the
unambiguous single-text-block case avoids guessing at a shape nobody recognizes.

The receipt fields the SDK reads out of any result are `state_id`, `frame_id`,
`action_sent`, `dispatch_status`, `state_sync_status`, `code`, `reason`, `snapshot_mode` and
`base_state_id`, taken from the first source that has each key. Producers have historically
put the same field in three different places, so all three are consulted.

## 6. Cold start

The Helper is started lazily by its first caller. A call that arrives too early returns a
**non-error** envelope carrying `kind: "CUA_NOT_READY"`, a `message`, a `reasonCode` and a
`retryable` flag. `createInvoker` then:

1. retries the identical call while `retryable === true`, up to `NOT_READY_MAX_ATTEMPTS`
   (6) attempts;
2. sleeps `NOT_READY_BACKOFF_MS` — 250, 500, 750, 1000, 1500 ms — clamping at the last value;
3. on exhaustion throws `TIMEOUT` when the envelope was retryable and `CONTROLLER_BUSY` when
   it was not, in both cases carrying the producer's own message and `reasonCode`.

A `possibly_sent` dispatch is never retried by this path: `assertUsable` rejects it first, so
the retry loop only ever replays calls that provably did nothing.

## 7. Error model in full

### Broker code → SDK code

| Broker code           | SDK code              |
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
| anything else         | `INTERNAL`            |

Falling through to `INTERNAL` is deliberate: a vague failure that makes the model re-observe
is safer than a confident mapping of a real fault onto "success".

### SDK-raised codes

| Code                           | Raised by            | When                                                                      |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------- |
| `INVALID_APP`                  | `client`             | `getApp` receives neither a non-empty string nor `{name\|bundle_id\|pid}` |
| `STALE_STATE`                  | `client`             | a pinned `window_id` fell back to the frontmost window                    |
| `STALE_STATE`                  | `target`             | an element index arrives with no observation behind it                    |
| `STRUCTURED_STATE_UNAVAILABLE` | `envelope`           | the observation lacks `state_id`, `elements`, `app` or `window`           |
| `NOT_SELECTABLE`               | `target`             | `selectText` finds no value to search, no match, or more than one         |
| `ACTION_UNAVAILABLE`           | `target`             | `performSecondaryAction` is asked for an empty or non-string action       |
| `ELEMENT_UNAVAILABLE`          | `target`             | pixels were requested and none came back                                  |
| `TIMEOUT`                      | `envelope`           | a `possibly_sent` dispatch, or an exhausted retryable cold start          |
| `CONTROLLER_BUSY`              | `envelope`           | a non-retryable not-ready envelope, or the broker's own `controller_busy` |
| `INTERNAL`                     | `target`, `envelope` | malformed target, key, direction, button or text; an unmapped broker code |

### Retry policy

`decideRetryPolicy(actionSent, code)`:

| Condition                       | Result                               |
| ------------------------------- | ------------------------------------ |
| `actionSent === true`           | `reobserve` — regardless of the code |
| code in `POINTLESS_RETRY_CODES` | `never`                              |
| code in `REACQUIRE_FIRST_CODES` | `reobserve`                          |
| otherwise                       | `retry`                              |

`POINTLESS_RETRY_CODES` is `CONTROLLER_BUSY`, `CONTROL_STOPPED`, `PERMISSION_DENIED`,
`NOT_AUTHORIZED`, `VERSION_MISMATCH`, `ACTION_UNAVAILABLE`, `NOT_SETTABLE`,
`NOT_SELECTABLE`. `REACQUIRE_FIRST_CODES` is `ELEMENT_UNAVAILABLE`, `STALE_STATE`,
`STRUCTURED_STATE_UNAVAILABLE` — the last two are SDK-raised rather than broker-raised, and
are listed here so a caller needs only one table.

`CONTROL_STOPPED` appears in the retry table but is not produced by any code path in these
five modules; it is reserved. The same is true of `APP_NOT_FOUND`, `AMBIGUOUS_APP` and
`SCREEN_LOCKED`, which appear nowhere in this plugin at all. Do not branch on those four
names.

## 8. Verifying an installation

```sh
node scripts/check-sdk.mjs      # or: pnpm check:sdk
```

That is the whole verification surface: it asserts each of the five modules is reachable and
that the entry module imports without a syntax error, which is what catches a seed that
copied `computer-use-client.mjs` without its four dependencies.

There is no other command. The client module has no argument parser — `--help` and a bare
invocation both produce no output and exit `0` — so it cannot be exercised from a shell, only
imported from a `node_repl` cell.
