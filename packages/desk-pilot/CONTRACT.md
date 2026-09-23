# desk-pilot module

The smallest compliant DeskPilot module: a manifest, one narrow port, one example, and no
implementation detail in the public surface.

## What this module owns

Nothing yet. At P0 the module owns **only the contract**:

- `contract.ts` — the single public entrypoint. Exports the `SurfaceAdapter` port (exactly 12
  methods, matching `maxPublicMethods`) plus the value types that cross layer boundaries.
- `ui-map.ts` / `actuation.ts` / `errors.ts` — the data shapes. Re-exported from `contract.ts`
  so consumers never deep-import.
- `guards.ts` — pure validation. No IO, no process, no timers. Every rejection here is
  `possiblySent: false` because the platform has not been touched.
- `module.ts` — manifest kept in sync with `architecture-policy.yaml`.

## Invariants

1. `SurfaceAdapter` exposes exactly 12 methods. Adding a method requires splitting the port,
   not raising the budget.
2. Coordinates are never addressable without a `frameId` (`assertCoordinateTarget`).
3. Element refs are never addressable across snapshots (`assertElementTarget`).
4. `secure` element values are redacted before they reach model context.
5. Adapters never invent error codes; `DESK_ERROR_CODES` is closed.
6. No adapter may silently degrade an unsupported primitive; it must throw
   `UNSUPPORTED_ON_PLATFORM`.

See `.agents/specs/desk-pilot.md` for the product rules, the platform capability matrix and the
Wayland decisions.
