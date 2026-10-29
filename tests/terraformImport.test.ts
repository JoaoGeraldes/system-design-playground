import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPONENT_KINDS } from '../src/content/components.ts';
import { Design } from '../src/model/design.ts';
import { toTerraform, type TerraformTarget } from '../src/model/terraform.ts';
import { parseTerraform } from '../src/model/terraformImport.ts';
import { loadTemplate, validateTemplate } from '../src/model/templates.ts';

function imported(text: string) {
  const result = parseTerraform(text);
  assert.ok('board' in result, 'error' in result ? result.error : '');
  return result;
}

const kindsOf = (text: string) =>
  imported(text)
    .board.nodes.map((node) => node.kind)
    .sort();

test('AWS resources become components, with users added in front', () => {
  const kinds = kindsOf(`
    resource "aws_lb" "front" {}
    resource "aws_instance" "web" {}
    resource "aws_db_instance" "main" {}
  `);
  assert.deepEqual(kinds, [
    'app-server',
    'client',
    'load-balancer',
    'sql-database',
  ]);
});

test('a resource that refers to another becomes a cable to it', () => {
  const { board } = imported(`
    resource "aws_db_instance" "main" {}
    resource "aws_instance" "web" {
      user_data = "DB=\${aws_db_instance.main.address}"
    }
  `);
  const web = board.nodes.find((node) => node.kind === 'app-server')!;
  const db = board.nodes.find((node) => node.kind === 'sql-database')!;
  assert.ok(
    board.cables.some(
      (cable) => cable.from.startsWith(web.id) && cable.to.startsWith(db.id),
    ),
  );
});

test('Railway services are told apart by their image', () => {
  const kinds = kindsOf(`
    resource "railway_project" "main" { name = "x" }
    resource "railway_service" "api" { source_repo = "a/b" }
    resource "railway_service" "db" { source_image = "postgres:16" }
    resource "railway_service" "cache" { source_image = "redis:7" }
  `);
  assert.deepEqual(kinds, ['app-server', 'cache', 'client', 'sql-database']);
});

test('a Railway variable joins the service that has it to the one it names', () => {
  const { board } = imported(`
    resource "railway_service" "api" { source_repo = "a/b" }
    resource "railway_service" "db" { source_image = "postgres:16" }
    resource "railway_variable" "x" {
      value      = "http://\${railway_service.db.name}.railway.internal"
      service_id = railway_service.api.id
    }
  `);
  assert.equal(
    board.cables.filter((cable) => !cable.from.startsWith('client')).length,
    1,
  );
});

test('unknown resources are shown as external services and reported', () => {
  const result = imported(`resource "google_pubsub_topic" "events" {}`);
  assert.ok(
    result.board.nodes.some((node) => node.kind === 'external-service'),
  );
  assert.match(result.notes[0], /google_pubsub_topic\.events/);
});

test('comments, strings and nested braces do not confuse it', () => {
  const kinds = kindsOf(`
    # resource "aws_sqs_queue" "ghost" {}
    resource "aws_instance" "web" {
      tags = { Name = "a } b { \${var.x}" } // trailing
    }
    /* resource "aws_lb" "ghost2" {} */
    resource "aws_sqs_queue" "jobs" {}
  `);
  assert.deepEqual(kinds, ['app-server', 'client', 'queue']);
});

test('text with no resources gives a reason instead of an empty board', () => {
  assert.ok('error' in parseTerraform('variable "x" {}'));
});

test('the board it makes is valid and loads', () => {
  const { board } = imported(`
    resource "aws_lb" "front" {}
    resource "aws_instance" "web" {}
  `);
  assert.deepEqual(validateTemplate(board), []);
  loadTemplate(new Design(), board);
});

test('exporting then importing keeps every component and cable', () => {
  const targets: TerraformTarget[] = ['aws', 'railway'];
  const design = new Design();
  const names = ['app-server', 'sql-database', 'cache', 'queue', 'worker'];
  const nodes = names.map((kind, i) =>
    design.addNode(kind, { x: i * 300, y: 0 }, kind.replace('-', '_')),
  );
  const wires = [
    [0, 1],
    [0, 2],
    [0, 3],
    [3, 4],
    [4, 1],
  ];
  for (const [a, b] of wires) {
    design.connect(
      { nodeId: nodes[a].id, side: 'right' },
      { nodeId: nodes[b].id, side: 'left' },
    );
  }
  for (const target of targets) {
    const { board } = imported(toTerraform(design, target).text);
    const kinds = board.nodes
      .map((node) => node.kind)
      .filter((kind) => kind !== 'client');
    assert.equal(kinds.length, 5, target);
    const shown = board.cables.filter(
      (cable) => !cable.from.startsWith('client'),
    );
    assert.equal(shown.length, wires.length, target);
  }
});

test('every kind that exports a resource imports back as that kind', () => {
  for (const target of ['aws', 'railway'] as TerraformTarget[]) {
    for (const { id } of COMPONENT_KINDS) {
      const design = new Design();
      design.addNode(id, { x: 0, y: 0 }, 'thing');
      const text = toTerraform(design, target).text;
      if (!/^resource "[a-z_0-9]+" "thing"/m.test(text)) continue;
      const result = parseTerraform(text);
      if ('error' in result) continue;
      const kinds = result.board.nodes.map((node) => node.kind);
      // Roles that share one resource type can't be told apart on import.
      const alike = [
        'app-server',
        'worker',
        'function',
        'cache',
        'queue',
        'pub-sub',
        'stream',
        'alerting',
        'websocket-gateway',
      ];
      assert.ok(
        kinds.includes(id) ||
          (alike.includes(id) && kinds.some((kind) => alike.includes(kind))),
        `${target} ${id} became ${kinds}`,
      );
    }
  }
});
