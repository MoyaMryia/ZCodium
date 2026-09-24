import { pathToFileURL } from "node:url";
// Electron's utilityProcess uses parentPort; this fixture bridges Node IPC to the same contract.
process.parentPort = {
  on(_event, listener) {
    process.on("message", (data) => listener({ data }));
  },
  postMessage(message) {
    process.send(message);
  },
};
globalThis.fetch = () => {
  throw new Error("Scheduler must not fetch official services");
};
await import(pathToFileURL(process.argv[2]).href);
