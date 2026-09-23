export const deskPilotModule = {
  id: "desk-pilot",
  requires: [],
  provides: ["desk-pilot-surface-port"],
  publicEntrypoints: ["packages/desk-pilot/src/contract.ts"],
} as const;
