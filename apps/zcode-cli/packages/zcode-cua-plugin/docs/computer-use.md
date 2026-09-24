# Computer Use API

The model-facing API is documented in [the Computer Use skill](../skills/computer-use/SKILL.md).
Load `scripts/computer-use-client.mjs` through the shared `node_repl` host and call
`setupComputerUseRuntime({ globals: globalThis })`. Do not execute that module as
a CLI or install a separate helper.

The plugin supplies the model-facing SDK and instructions. `node-repl-host`
owns the Worker bridge and authenticated broker; `@zcode/zcode-cua` adapts calls
to the bundled `@trycua/cua-driver` runtime. Linux and Windows use the in-process
SDK when Computer Use is enabled. An unavailable runtime fails closed.

```text
node_repl cell → skill SDK → Worker bridge → host broker
              → CUA adapter → bundled native driver → application UI
```

`getApp` and `getWindow` return bound app objects. Observe through `getAXState`,
`getScreenshot`, or `getAXStateAndScreenshot`; then act and observe the result.
Bindings and JavaScript variables are local to a cell. The runtime holds the
current window observation, so each new cell must bind again.

Targets in the JavaScript API are element numbers or `[x, y]` screenshot pixels.
The SDK converts them to object targets on the broker wire. The adapter resolves
these against the same window's current observation and sends native element
tokens or pixel coordinates to the driver. Stale frame identities, missing
observations, and invalid pixels fail before an input event is sent. Dragging an
element uses its geometry from a current screenshot; it does not pass invented
native token arguments.

Element frames use screen coordinates; dragging subtracts the observed window
origin before dispatch. `drag(..., { deliveryMode: "foreground" })` explicitly
selects the driver's focus-switching path for apps that ignore background drags.
The default is unchanged; an already dispatched drag is never replayed automatically.

Input failures retain `actionSent` and retry guidance. After a possibly sent
operation, re-observe instead of blindly repeating it. Native permissions and
window availability still apply; loading the SDK does not grant access.

`selectText` and `performSecondaryAction` currently report `ACTION_UNAVAILABLE`.
The adapter does not implement automatic launching of closed applications or
rich clipboard formats. See the skill for supported operations and recovery.
