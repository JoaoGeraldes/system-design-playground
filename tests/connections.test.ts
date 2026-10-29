import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPONENT_KINDS } from '../src/content/components.ts';
import { adviseConnection } from '../src/simulation/connections.ts';

test('a client calling a database directly is flagged, with a server suggested', () => {
  const advice = adviseConnection('client', 'sql-database');
  assert.match(advice!.suggestion, /App Server/);
  assert.equal(advice!.flip, false);
});

test('something pointing at a client is flagged, and flipping fixes it', () => {
  assert.equal(adviseConnection('app-server', 'client')?.flip, true);
});

test('a server calling a database is fine', () => {
  assert.equal(adviseConnection('app-server', 'sql-database'), undefined);
});

test('a database copying to another database is fine', () => {
  assert.equal(adviseConnection('sql-database', 'sql-database'), undefined);
});

test('a database calling a server is flagged', () => {
  assert.equal(adviseConnection('sql-database', 'app-server')?.flip, true);
});

test('every pair of components can be looked up without error', () => {
  for (const a of COMPONENT_KINDS) {
    for (const b of COMPONENT_KINDS) adviseConnection(a.id, b.id);
  }
});
