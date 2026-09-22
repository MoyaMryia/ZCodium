import { writeDerivedTrajectories } from "./derive.js";
import { writeModelIoAnthropicTrajectory } from "./model-io.js";

interface CliOptions {
  referenceRequestPath?: string;
  inputPath?: string;
  outDir?: string;
  querySource?: string;
}

try {
  const command = process.argv[2];
  if (command !== "derive" && command !== "model-io") printUsageAndExit();
  const options = parseOptions(process.argv.slice(3));
  requireOption(options.inputPath, "--input");
  requireOption(options.outDir, "--out");
  if (command === "derive") {
    await writeDerivedTrajectories({
      referenceRequestPath: options.referenceRequestPath,
      inputPath: options.inputPath,
      outDir: options.outDir,
    });
  } else {
    await writeModelIoAnthropicTrajectory({
      inputPath: options.inputPath,
      outDir: options.outDir,
      querySource: options.querySource,
    });
  }
  console.log("Offline trajectory conversion completed.");
} catch {
  console.error("Offline trajectory conversion failed. Check the input file and command options.");
  process.exitCode = 1;
}

function parseOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    const value = args[index + 1];
    if (!value) throw new Error("Missing option value");
    index += 1;
    switch (arg) {
      case "--out":
        options.outDir = value;
        break;
      case "--input":
        options.inputPath = value;
        break;
      case "--reference-request":
        options.referenceRequestPath = value;
        break;
      case "--query-source":
        options.querySource = value;
        break;
      default:
        throw new Error("Unknown argument");
    }
  }
  return options;
}

function requireOption<T>(value: T | undefined, flag: string): asserts value is T {
  if (value === undefined || value === "") throw new Error(`Missing required option ${flag}`);
}

function printUsageAndExit(): never {
  console.error(`Usage:
  pnpm --filter @zcode/prompt-trajectory derive -- --input <trajectory.jsonl> --out <dir> [--reference-request <path>]
  pnpm --filter @zcode/prompt-trajectory model-io -- --input <model-io.jsonl> --out <dir> [--query-source main_turn]`);
  process.exit(1);
}
