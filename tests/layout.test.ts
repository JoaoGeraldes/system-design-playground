import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NODE_HEIGHT, NODE_WIDTH, Design } from '../src/model/design.ts';
import {
  countCrossings,
  layoutPositions,
  tidyUp,
} from '../src/model/layout.ts';
import { loadTemplate, type Template } from '../src/model/templates.ts';

function board(nodes: Record<string, string>, cables: string[]): Design {
  const design = new Design();
  const ids = new Map<string, string>();
  Object.entries(nodes).forEach(([name, kind], i) => {
    ids.set(name, design.addNode(kind, { x: i * 10, y: i * 10 }).id);
  });
  for (const cable of cables) {
    const [from, to] = cable.split('>');
    design.connect(
      { nodeId: ids.get(from)!, side: 'right' },
      { nodeId: ids.get(to)!, side: 'left' },
    );
  }
  return design;
}

const templates = ['', 'foundations/'].flatMap((folder) => {
  const url = new URL(`../src/content/templates/${folder}`, import.meta.url);
  return readdirSync(url)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(new URL(file, url), 'utf8')));
});

const overlaps = (design: Design) =>
  design.nodes.some((a, i) =>
    design.nodes
      .slice(i + 1)
      .some(
        (b) =>
          Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT,
      ),
  );

test('traffic reads left to right: each component sits right of what calls it', () => {
  const design = board(
    { user: 'client', web: 'app-server', db: 'sql-database' },
    ['user>web', 'web>db'],
  );
  const at = layoutPositions(design);
  const [user, web, db] = design.nodes.map((node) => at.get(node.id)!.x);
  assert.ok(user < web && web < db);
});

test('two clients and two servers wired in a tangle end up uncrossed', () => {
  const design = board(
    { a: 'client', b: 'client', x: 'app-server', y: 'app-server' },
    ['a>y', 'b>x'],
  );
  tidyUp(design);
  assert.equal(countCrossings(design), 0);
});

test('a loop does not hang or lose components', () => {
  const design = board({ a: 'app-server', b: 'cache' }, ['a>b', 'b>a']);
  assert.equal(layoutPositions(design).size, 2);
});

/** The same board with its components thrown about, the same way every time. */
function scrambled(template: Template): Design {
  const design = new Design();
  loadTemplate(design, template);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const node of design.nodes) {
    design.moveNode(node.id, { x: random() * 1200, y: random() * 800 });
  }
  return design;
}

test('tidying scrambled boards leaves no overlaps and far fewer crossings', () => {
  let before = 0;
  let after = 0;
  for (const template of templates) {
    const design = scrambled(template);
    before += countCrossings(design);
    tidyUp(design);
    after += countCrossings(design);
    assert.ok(!overlaps(design), `${template.id} overlaps`);
  }
  assert.ok(after * 2 <= before, `${before} crossings became ${after}`);
});

test('tidying keeps the centre of the board where it was', () => {
  const design = board({ a: 'client', b: 'app-server' }, ['a>b']);
  design.moveNode(design.nodes[0].id, { x: 1000, y: 500 });
  design.moveNode(design.nodes[1].id, { x: 1100, y: 500 });
  tidyUp(design);
  const [first, second] = design.nodes;
  assert.equal((first.x + second.x) / 2, 1050);
  assert.equal((first.y + second.y) / 2, 500);
});
