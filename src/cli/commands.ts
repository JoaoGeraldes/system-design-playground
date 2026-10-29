import { Design } from '../model/design.ts';
import { tidyUp } from '../model/layout.ts';
import { loadTemplate, parseBoard, toTemplate } from '../model/templates.ts';
import {
  TERRAFORM_TARGETS,
  toTerraform,
  type TerraformTarget,
} from '../model/terraform.ts';
import { parseTerraform } from '../model/terraformImport.ts';
import { checkFlow } from '../simulation/flowCheck.ts';
import { AVERAGE_DAY, WORST_DAY } from '../simulation/load.ts';

/** What the CLI needs from the outside world, so tests can fake it. */
export interface CliFiles {
  read(path: string): string;
  /** The .tf files in a folder, or null when the path isn't a folder. */
  terraformFilesIn(path: string): string[] | null;
}

export interface CliResult {
  code: number;
  out: string;
  err: string;
}

export const USAGE = `Usage: sdp <command> [options]

Commands:
  check <board.json> [--worst-day]         Does the design work, and why not? Exits 1 if not.
  layout <board.json>                      Print the board with components tidied.
  export-terraform <board.json> --target ${TERRAFORM_TARGETS.map((t) => t.id).join('|')}
                                           Print Terraform for the board.
  import-terraform <file.tf|folder>        Print a board made from Terraform.
`;

const done = (out: string): CliResult => ({ code: 0, out, err: '' });
const fail = (err: string, code = 2): CliResult => ({ code, out: '', err });

function loadBoard(path: string, files: CliFiles): Design | string {
  const result = parseBoard(files.read(path), path);
  if ('error' in result) return `${path}: ${result.error}`;
  const design = new Design();
  loadTemplate(design, result.board);
  return design;
}

const boardJson = (design: Design) =>
  `${JSON.stringify(toTemplate(design), null, 2)}\n`;

export function runCommand(argv: string[], files: CliFiles): CliResult {
  const [command, ...rest] = argv;
  const flags = rest.filter((arg) => arg.startsWith('--'));
  const positional = rest.filter(
    (arg, i) => !arg.startsWith('--') && rest[i - 1] !== '--target',
  );
  const [path] = positional;
  if (!command || command === 'help' || flags.includes('--help')) {
    return done(USAGE);
  }
  if (!path) return fail(`"${command}" needs a file.\n\n${USAGE}`);

  try {
    if (command === 'import-terraform') return importTerraform(path, files);
    const design = loadBoard(path, files);
    if (typeof design === 'string') return fail(`${design}\n`);

    if (command === 'layout') {
      tidyUp(design);
      return done(boardJson(design));
    }
    if (command === 'export-terraform') {
      const target = rest[rest.indexOf('--target') + 1] as TerraformTarget;
      if (!TERRAFORM_TARGETS.some(({ id }) => id === target)) {
        return fail(
          '--target must be one of: ' +
            TERRAFORM_TARGETS.map((t) => t.id).join(', ') +
            '\n',
        );
      }
      const { text, warnings } = toTerraform(design, target);
      return {
        code: 0,
        out: text,
        err: warnings.map((w) => `warning: ${w}\n`).join(''),
      };
    }
    if (command === 'check')
      return check(design, flags.includes('--worst-day'));
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n`, 1);
  }
  return fail(`Unknown command "${command}".\n\n${USAGE}`);
}

function check(design: Design, worstDay: boolean): CliResult {
  const report = checkFlow(design, worstDay ? WORST_DAY : AVERAGE_DAY);
  const lines = [report.works ? 'It works.' : "It doesn't work."];
  for (const issue of report.issues) {
    lines.push(
      `\n[${issue.level}] ${issue.title}`,
      `  Why: ${issue.why}`,
      `  Try: ${issue.fix}`,
    );
  }
  if (report.issues.length === 0) lines.push('Nothing to improve.');
  return { code: report.works ? 0 : 1, out: `${lines.join('\n')}\n`, err: '' };
}

function importTerraform(path: string, files: CliFiles): CliResult {
  const paths = files.terraformFilesIn(path) ?? [path];
  const result = parseTerraform(
    paths.map((file) => files.read(file)).join('\n'),
  );
  if ('error' in result) return fail(`${path}: ${result.error}\n`, 1);
  const design = new Design();
  loadTemplate(design, result.board);
  return {
    code: 0,
    out: boardJson(design),
    err: result.notes.map((note) => `note: ${note}\n`).join(''),
  };
}
