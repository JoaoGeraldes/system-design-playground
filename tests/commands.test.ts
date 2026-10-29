import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCommand, type CliFiles } from '../src/cli/commands.ts';

const board = (nodes: object[], cables: object[]) =>
  JSON.stringify({ nodes, cables });

const working = board(
  [
    { id: 'c', kind: 'client', x: 0, y: 0 },
    { id: 'w', kind: 'app-server', x: 300, y: 0 },
    { id: 'd', kind: 'sql-database', x: 600, y: 0 },
  ],
  [
    { from: 'c.right', to: 'w.left' },
    { from: 'w.right', to: 'd.left' },
  ],
);
const broken = board(
  [
    { id: 'c', kind: 'client', x: 0, y: 0 },
    { id: 'd', kind: 'sql-database', x: 300, y: 0 },
  ],
  [{ from: 'c.right', to: 'd.left' }],
);

const files = (
  contents: Record<string, string>,
  folders: Record<string, string[]> = {},
): CliFiles => ({
  read: (path) => {
    if (!(path in contents)) throw new Error(`No such file: ${path}`);
    return contents[path];
  },
  terraformFilesIn: (path) => folders[path] ?? null,
});

test('check passes a working board with exit code 0', () => {
  const result = runCommand(['check', 'a.json'], files({ 'a.json': working }));
  assert.equal(result.code, 0);
  assert.match(result.out, /^It works\./);
});

test('check fails a broken board with exit code 1, saying why', () => {
  const result = runCommand(['check', 'a.json'], files({ 'a.json': broken }));
  assert.equal(result.code, 1);
  assert.match(result.out, /looks wrong/);
  assert.match(result.out, /Why:/);
});

test('export-terraform prints Terraform for the chosen target', () => {
  const result = runCommand(
    ['export-terraform', 'a.json', '--target', 'railway'],
    files({ 'a.json': working }),
  );
  assert.equal(result.code, 0);
  assert.match(result.out, /railway_service/);
});

test('export-terraform rejects an unknown target', () => {
  const result = runCommand(
    ['export-terraform', 'a.json', '--target', 'azure'],
    files({ 'a.json': working }),
  );
  assert.equal(result.code, 2);
  assert.match(result.err, /--target must be one of: aws, railway/);
});

test('layout prints a board that loads again', () => {
  const tidy = runCommand(['layout', 'a.json'], files({ 'a.json': working }));
  assert.equal(tidy.code, 0);
  const again = runCommand(['check', 'b.json'], files({ 'b.json': tidy.out }));
  assert.equal(again.code, 0);
});

test('import-terraform reads one file, or every .tf file in a folder', () => {
  const one = runCommand(
    ['import-terraform', 'a.tf'],
    files({ 'a.tf': 'resource "aws_instance" "web" {}' }),
  );
  assert.match(one.out, /app-server/);
  const folder = runCommand(
    ['import-terraform', 'infra'],
    files(
      {
        'infra/a.tf': 'resource "aws_instance" "web" {}',
        'infra/b.tf': 'resource "aws_sqs_queue" "jobs" {}',
      },
      { infra: ['infra/a.tf', 'infra/b.tf'] },
    ),
  );
  assert.match(folder.out, /app-server/);
  assert.match(folder.out, /queue/);
});

test('a bad board file is reported by name, without a stack trace', () => {
  const result = runCommand(['check', 'a.json'], files({ 'a.json': '{' }));
  assert.equal(result.code, 2);
  assert.match(result.err, /^a\.json: /);
});

test('a missing file gives a plain message and exit code 1', () => {
  const result = runCommand(['check', 'nope.json'], files({}));
  assert.equal(result.code, 1);
  assert.match(result.err, /No such file/);
});

test('no command prints the usage', () => {
  assert.match(runCommand([], files({})).out, /Usage: sdp/);
  assert.equal(
    runCommand(['wat', 'a.json'], files({ 'a.json': working })).code,
    2,
  );
});
