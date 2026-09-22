import { safeLogArgs, safeDiagnosticFrames } from "@zcode/shared";
import { formatJson } from "@zcode/core";
import type { Logger } from "@zcode/contracts";
import type { RunContext, GlobalOptions } from "@zcode/shared-types";
import type {
  inspectZCodeSkill,
  InspectZCodeSkillOptions,
  listZCodeSkills,
  ListZCodeSkillsOptions,
  ZCodeSkillInspection,
} from "@zcode/bootstrap";
import type { CliEnv } from "./env.js";

type BootstrapModule = typeof import("@zcode/bootstrap");
type CliSkillListOutcome = Awaited<ReturnType<typeof listZCodeSkills>>;
type CliSkillListItem = CliSkillListOutcome["skills"][number];

interface SkillsCommandDependencies {
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectZCodeSkillOptions) => ReturnType<typeof inspectZCodeSkill>;
  listSkills?: (options: ListZCodeSkillsOptions) => ReturnType<typeof listZCodeSkills>;
  logger?: Logger;
  loadBootstrapModule?: () => Promise<BootstrapModule>;
}

const SKILLS_COMMAND_USAGE = "Usage: zcode skills [list|inspect <name>]";

export const runSkillsCommand = async (
  ctx: RunContext,
  options: GlobalOptions,
  deps: SkillsCommandDependencies,
  args: string[],
): Promise<number> => {
  const subcommand = args[0] ?? "list";
  if (subcommand === "list") {
    if (args.length > 1) return failUsage(ctx);
    return await runSkillsListCommand(ctx, options, deps);
  }

  if (subcommand === "inspect") {
    if (args.length !== 2 || args[1]?.trim().length === 0) return failUsage(ctx);
    return await runSkillsInspectCommand(ctx, options, deps, args[1]);
  }

  ctx.stderr.write(`Unknown skills command: ${subcommand}\n${SKILLS_COMMAND_USAGE}\n`);
  return 1;
};

function failUsage(ctx: RunContext): number {
  ctx.stderr.write(`${SKILLS_COMMAND_USAGE}\n`);
  return 1;
}

async function runSkillsListCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: SkillsCommandDependencies,
): Promise<number> {
  try {
    const env = deps.env ?? process.env;
    const workingDirectory = (deps.cwd ?? process.cwd)();
    const bootstrap = deps.loadBootstrapModule ?? (() => import("@zcode/bootstrap"));
    const listSkills = deps.listSkills ?? (await bootstrap()).listZCodeSkills;
    const outcome = await listSkills({
      env,
      logger: deps.logger,
      workingDirectory,
    });

    ctx.stdout.write(
      options.json
        ? formatSkillJson(outcome, workingDirectory)
        : formatHumanSkillList(outcome, options),
    );
    return 0;
  } catch (error) {
    return reportSkillsError(ctx, options, error);
  }
}

async function runSkillsInspectCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: SkillsCommandDependencies,
  name: string,
): Promise<number> {
  try {
    const env = deps.env ?? process.env;
    const workingDirectory = (deps.cwd ?? process.cwd)();
    const bootstrap = deps.loadBootstrapModule ?? (() => import("@zcode/bootstrap"));
    const inspectSkill = deps.inspectSkill ?? (await bootstrap()).inspectZCodeSkill;
    const inspection = await inspectSkill({
      env,
      logger: deps.logger,
      name,
      workingDirectory,
    });

    ctx.stdout.write(
      options.json
        ? formatSkillInspectionJson(inspection, workingDirectory)
        : formatHumanSkillInspection(inspection, options),
    );
    return 0;
  } catch (error) {
    return reportSkillsError(ctx, options, error);
  }
}

function reportSkillsError(ctx: RunContext, options: GlobalOptions, error: unknown): number {
  const message = JSON.stringify(safeLogArgs([error]));
  ctx.stderr.write(`Error: ${message}\n`);
  if (options.verbose && error instanceof Error && error.stack) {
    ctx.stderr.write(`${safeDiagnosticFrames(error.stack).join("\n")}\n`);
  }
  return 1;
}

function formatSkillDescription(skill: CliSkillListItem): string {
  return skill.whenToUse ? `${skill.description} ${skill.whenToUse}` : skill.description;
}

function formatSkillName(skill: Pick<CliSkillListItem, "name" | "qualifiedName">): string {
  return skill.qualifiedName ?? skill.name;
}

function formatHumanSkillList(outcome: CliSkillListOutcome, options: GlobalOptions): string {
  if (outcome.skills.length === 0) {
    return "No skills found.\n";
  }

  const lines = [`Available skills (${outcome.skills.length})`];
  for (const skill of outcome.skills) {
    const alias = skill.qualifiedName ? `; alias ${skill.name}` : "";
    lines.push(`- ${formatSkillName(skill)} (${skill.scope}/${skill.source}${alias})`);
    lines.push(`  ${formatSkillDescription(skill)}`);
    lines.push(`  ${skill.path}`);
  }

  appendDiagnostics(lines, outcome.diagnostics, options);
  return `${lines.join("\n")}\n`;
}

function formatHumanSkillInspection(
  inspection: ZCodeSkillInspection,
  options: GlobalOptions,
): string {
  const { metadata } = inspection.skill;
  const lines = [
    `Skill: ${formatSkillName(metadata)}`,
    `scope/source: ${metadata.scope}/${metadata.source}`,
    `path: ${metadata.path}`,
    `directory: ${metadata.directory}`,
    `description: ${metadata.description}`,
  ];

  if (metadata.pluginName) lines.push(`pluginName: ${metadata.pluginName}`);
  if (metadata.qualifiedName) lines.push(`qualifiedName: ${metadata.qualifiedName}`);
  if (metadata.whenToUse) lines.push(`whenToUse: ${metadata.whenToUse}`);
  lines.push(`safeToAutoLoad: ${metadata.safeToAutoLoad ? "yes" : "no"}`);
  lines.push(
    `size: ${inspection.skill.bytesRead}/${inspection.skill.sizeBytes} bytes${inspection.skill.truncated ? " (truncated)" : ""}`,
  );
  lines.push(
    "",
    "Content",
    inspection.skill.content.length > 0 ? inspection.skill.content : "(empty)",
  );

  appendDiagnostics(lines, inspection.diagnostics, options);
  return `${lines.join("\n")}\n`;
}

function appendDiagnostics(
  lines: string[],
  diagnostics: CliSkillListOutcome["diagnostics"],
  options: GlobalOptions,
): void {
  if (!options.verbose || diagnostics.length === 0) return;

  lines.push("", `Diagnostics (${diagnostics.length})`);
  for (const diagnostic of diagnostics) {
    const location = diagnostic.path ? ` (${diagnostic.path})` : "";
    lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
  }
}

const formatSkillJson = (outcome: CliSkillListOutcome, cwd: string): string =>
  formatJson({
    cwd,
    diagnostics: outcome.diagnostics.map(formatDiagnosticJson),
    skills: outcome.skills.map((skill) => ({
      description: skill.description,
      directory: skill.directory,
      name: skill.name,
      path: skill.path,
      ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
      ...(skill.qualifiedName ? { qualifiedName: skill.qualifiedName } : {}),
      rootPath: skill.rootPath,
      scope: skill.scope,
      source: skill.source,
      ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
    })),
    totalDiscovered: outcome.totalDiscovered,
  });

const formatSkillInspectionJson = (inspection: ZCodeSkillInspection, cwd: string): string =>
  formatJson({
    cwd,
    diagnostics: inspection.diagnostics.map(formatDiagnosticJson),
    skill: {
      baseDirectory: inspection.skill.baseDirectory,
      bytesRead: inspection.skill.bytesRead,
      content: inspection.skill.content,
      metadata: {
        description: inspection.skill.metadata.description,
        directory: inspection.skill.metadata.directory,
        frontmatterKeys: inspection.skill.metadata.frontmatterKeys,
        name: inspection.skill.metadata.name,
        path: inspection.skill.metadata.path,
        ...(inspection.skill.metadata.pluginName
          ? { pluginName: inspection.skill.metadata.pluginName }
          : {}),
        ...(inspection.skill.metadata.qualifiedName
          ? { qualifiedName: inspection.skill.metadata.qualifiedName }
          : {}),
        rootPath: inspection.skill.metadata.rootPath,
        safeToAutoLoad: inspection.skill.metadata.safeToAutoLoad,
        scope: inspection.skill.metadata.scope,
        source: inspection.skill.metadata.source,
        ...(inspection.skill.metadata.whenToUse
          ? { whenToUse: inspection.skill.metadata.whenToUse }
          : {}),
      },
      sizeBytes: inspection.skill.sizeBytes,
      truncated: inspection.skill.truncated,
    },
  });

function formatDiagnosticJson(diagnostic: CliSkillListOutcome["diagnostics"][number]) {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path ? { path: diagnostic.path } : {}),
    severity: diagnostic.severity,
    ...(diagnostic.skillName ? { skillName: diagnostic.skillName } : {}),
  };
}
