#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../src/cli/commands.ts';

const result = runCommand(process.argv.slice(2), {
  read: (path) => readFileSync(path, 'utf8'),
  terraformFilesIn: (path) =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((file) => file.endsWith('.tf'))
          .map((file) => join(path, file))
      : null,
});
process.stdout.write(result.out);
process.stderr.write(result.err);
process.exitCode = result.code;
