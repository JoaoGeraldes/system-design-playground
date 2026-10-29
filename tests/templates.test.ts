import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Design } from '../src/model/design.ts';
import {
  loadTemplate,
  parseBoard,
  toTemplate,
  validateTemplate,
  type Template,
} from '../src/model/templates.ts';

// Foundations live in their own folder but share ids with the templates.
const templateFolders = [
  '../src/content/templates/',
  '../src/content/templates/foundations/',
  '../src/content/templates/experiments/',
];
const templateFiles = templateFolders.flatMap((folder) => {
  const url = new URL(folder, import.meta.url);
  return readdirSync(url)
    .filter((file) => file.endsWith('.json'))
    .map((file) => new URL(file, url));
});

function readTemplate(file: URL): Template {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function tinyTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tiny',
    title: 'Tiny',
    summary: 'A client and a server.',
    lesson: { problem: 'p', why: ['w'], takeaways: ['t'] },
    nodes: [
      { id: 'client', kind: 'client', x: 0, y: 0 },
      { id: 'server', kind: 'app-server', label: 'API', x: 300, y: 0 },
    ],
    cables: [{ from: 'client.right', to: 'server.left', label: 'HTTP' }],
    ...overrides,
  };
}

test('every template and foundation file is valid', () => {
  assert.ok(templateFiles.length >= 21);
  for (const file of templateFiles) {
    assert.deepEqual(validateTemplate(readTemplate(file)), [], file.pathname);
  }
});

test('templates and foundations all have unique ids and complete lessons', () => {
  const templates = templateFiles.map(readTemplate);
  const ids = new Set(templates.map((template) => template.id));
  assert.equal(ids.size, templates.length);
  for (const { id, title, summary, lesson } of templates) {
    assert.ok(title && summary && lesson.problem, id);
    assert.ok(lesson.why.length > 0 && lesson.takeaways.length > 0, id);
  }
});

test('loading a template replaces the board with its components', () => {
  const design = new Design();
  design.addNode('cache', { x: 999, y: 999 });
  loadTemplate(design, tinyTemplate());
  assert.deepEqual(
    design.nodes.map(({ kind, label, x, y }) => ({ kind, label, x, y })),
    [
      { kind: 'client', label: undefined, x: 0, y: 0 },
      { kind: 'app-server', label: 'API', x: 300, y: 0 },
    ],
  );
});

test('loading a template connects its cables with their labels', () => {
  const design = new Design();
  loadTemplate(design, tinyTemplate());
  const [cable] = design.cables;
  assert.equal(design.cables.length, 1);
  assert.equal(cable.label, 'HTTP');
  assert.equal(cable.from.side, 'right');
  assert.equal(design.getNode(cable.to.nodeId).label, 'API');
});

test('loading a template brings its groups along', () => {
  const design = new Design();
  const region = { label: 'EU', x: 0, y: 0, width: 400, height: 300 };
  loadTemplate(design, tinyTemplate({ groups: [region] }));
  assert.deepEqual(design.groups, [region]);
});

test('an invalid template is refused and leaves the board untouched', () => {
  const design = new Design();
  design.addNode('cache', { x: 0, y: 0 });
  const broken = tinyTemplate({
    cables: [{ from: 'client.right', to: 'ghost.left' }],
  });
  assert.throws(() => loadTemplate(design, broken), /unknown node "ghost"/);
  assert.equal(design.nodes.length, 1);
});

test('validation reports unknown kinds, bad ends and duplicate cables', () => {
  const problems = validateTemplate(
    tinyTemplate({
      nodes: [
        { id: 'client', kind: 'client', x: 0, y: 0 },
        { id: 'server', kind: 'mainframe', x: 300, y: 0 },
      ],
      cables: [
        { from: 'client.right', to: 'server.left' },
        { from: 'server.top', to: 'client.bottom' },
        { from: 'client', to: 'server.middle' },
        { from: 'client.top', to: 'client.left' },
      ],
    }),
  );
  assert.deepEqual(problems, [
    'Node "server" has unknown kind "mainframe"',
    'Cable server.top → client.bottom is a duplicate',
    'Cable client → server.middle must use "nodeId.side" ends',
    'Cable client → server.middle must use "nodeId.side" ends',
    'Cable client.top → client.left loops to itself',
  ]);
});

test('one-way cables stay one-way when loaded and exported', () => {
  const design = new Design();
  const cables = [{ from: 'client.right', to: 'server.left', oneWay: true }];
  loadTemplate(design, tinyTemplate({ cables }));
  assert.equal(design.cables[0].oneWay, true);
  assert.equal(toTemplate(design).cables[0].oneWay, true);
});

test('a client keeps its number of users when loaded and exported', () => {
  const design = new Design();
  const nodes = [{ id: 'client', kind: 'client', users: 100_000, x: 0, y: 0 }];
  loadTemplate(design, tinyTemplate({ nodes, cables: [] }));
  assert.equal(design.nodes[0].users, 100_000);
  assert.equal(toTemplate(design).nodes[0].users, 100_000);
});

test('the board exported as JSON loads back into the same design', () => {
  const original = new Design();
  loadTemplate(original, tinyTemplate());
  const exported = toTemplate(original);
  assert.deepEqual(validateTemplate(exported), []);

  const copy = new Design();
  loadTemplate(copy, exported);
  const shape = (design: Design) => ({
    nodes: design.nodes.map(({ kind, label, x, y }) => [kind, label, x, y]),
    cables: design.cables.map(({ from, to, label }) => [
      design.getNode(from.nodeId).kind,
      from.side,
      design.getNode(to.nodeId).kind,
      to.side,
      label,
    ]),
  });
  assert.deepEqual(shape(copy), shape(original));
});

function importError(text: string): string {
  const result = parseBoard(text, 'board.json');
  assert.ok('error' in result, 'expected the file to be rejected');
  return result.error;
}

test('an exported board imports back unchanged', () => {
  const original = new Design();
  loadTemplate(original, tinyTemplate({ groups: [] }));
  const exported = JSON.stringify(toTemplate(original));
  const result = parseBoard(exported, 'board.json');
  assert.ok('board' in result);
  assert.deepEqual(result.board.nodes, toTemplate(original).nodes);
  assert.equal(result.board.title, 'board.json');
});

test('a file that is not JSON is rejected in plain words', () => {
  assert.match(importError('{ nodes: oops'), /isn't valid JSON/);
});

test('JSON that is not a board is rejected', () => {
  assert.match(importError('[1, 2, 3]'), /"nodes" list/);
  assert.match(importError('{"name": "hello"}'), /"nodes" list/);
});

test('a component without a position is rejected by number', () => {
  const text = JSON.stringify({
    nodes: [
      { id: 'a', kind: 'client', x: 0, y: 0 },
      { id: 'b', kind: 'cache', x: 'left', y: 0 },
    ],
  });
  assert.match(importError(text), /^Component 2 needs/);
});

test('unknown components and broken cables are reported by name', () => {
  const text = JSON.stringify({
    nodes: [{ id: 'a', kind: 'mainframe', x: 0, y: 0 }],
    cables: [{ from: 'a.right', to: 'ghost.left' }],
  });
  assert.equal(
    importError(text),
    'Node "a" has unknown kind "mainframe" (and 1 more problem).',
  );
});

test('groups without a size are rejected', () => {
  const text = JSON.stringify({ nodes: [], groups: [{ label: 'EU' }] });
  assert.match(importError(text), /^Group 1 needs/);
});
