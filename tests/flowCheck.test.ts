import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Design } from '../src/model/design.ts';
import { loadTemplate } from '../src/model/templates.ts';
import { checkFlow, flowStatus } from '../src/simulation/flowCheck.ts';

function board(
  nodes: Record<string, string>,
  cables: string[],
  users = 1_000,
): Design {
  const design = new Design();
  const ids = new Map<string, string>();
  Object.entries(nodes).forEach(([name, kind], i) => {
    const node = design.addNode(kind, { x: i * 300, y: 0 });
    if (kind === 'client') node.users = users;
    ids.set(name, node.id);
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

const titles = (design: Design) =>
  checkFlow(design).issues.map((issue) => issue.title);

test('an empty board has no users, so it does not work', () => {
  const report = checkFlow(new Design());
  assert.equal(report.works, false);
  assert.match(report.issues[0].title, /Nobody uses/);
});

test('a client with nothing connected does not work', () => {
  const report = checkFlow(board({ user: 'client' }, []));
  assert.equal(report.works, false);
  assert.match(report.issues[0].title, /isn't connected/);
});

test('a client, a server and a database work', () => {
  const report = checkFlow(
    board({ user: 'client', web: 'app-server', db: 'sql-database' }, [
      'user>web',
      'web>db',
    ]),
  );
  assert.equal(report.works, true);
  assert.equal(flowStatus(report), 'suggestion');
  assert.deepEqual(
    report.issues.map((issue) => issue.level),
    ['suggestion'],
  );
});

test('an overloaded server fails, naming it and what to try', () => {
  const report = checkFlow(
    board(
      { user: 'client', web: 'app-server', db: 'sql-database' },
      ['user>web', 'web>db'],
      10_000_000,
    ),
  );
  assert.equal(report.works, false);
  const failing = report.issues.find((issue) => issue.level === 'error')!;
  assert.match(failing.why, /too busy/);
  assert.ok(failing.fix.length > 0);
});

test('a design with nothing to improve has an ok status', () => {
  const design = board(
    {
      user: 'client',
      lb: 'load-balancer',
      a: 'app-server',
      b: 'app-server',
      db: 'sql-database',
    },
    ['user>lb', 'lb>a', 'lb>b', 'a>db', 'b>db'],
  );
  assert.equal(flowStatus(checkFlow(design)), 'ok');
});

test('a broken design has an error status', () => {
  assert.equal(flowStatus(checkFlow(new Design())), 'error');
});

test('a server with no database suggests that nothing remembers anything', () => {
  const design = board({ user: 'client', web: 'app-server' }, ['user>web']);
  assert.ok(titles(design).includes('Nothing remembers anything'));
  assert.equal(checkFlow(design).works, true);
});

test('a component no traffic reaches is reported', () => {
  const design = board({ user: 'client', web: 'app-server', lonely: 'cache' }, [
    'user>web',
  ]);
  assert.ok(titles(design).some((title) => /never gets traffic/.test(title)));
});

test('a client wired straight to a database is reported as a wrong connection', () => {
  const design = board({ user: 'client', db: 'sql-database' }, ['user>db']);
  assert.equal(checkFlow(design).works, false);
  assert.ok(titles(design).some((title) => /looks wrong/.test(title)));
});

test('the Broken on purpose board does not work, and says what to fix', () => {
  const file = new URL(
    '../src/content/templates/experiments/01-broken-on-purpose.json',
    import.meta.url,
  );
  const design = new Design();
  loadTemplate(design, JSON.parse(readFileSync(file, 'utf8')));
  const report = checkFlow(design);
  assert.ok(report.issues.some((issue) => /looks wrong/.test(issue.title)));
  assert.ok(
    report.issues.some((issue) => /never gets traffic/.test(issue.title)),
  );
});
