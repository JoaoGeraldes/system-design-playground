import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMPONENT_KINDS } from '../src/content/components.ts';
import { fixesFor } from '../src/simulation/fixes.ts';

const boardIds = [
  '../src/content/templates/',
  '../src/content/templates/foundations/',
  '../src/content/templates/experiments/',
].flatMap((folder) => {
  const url = new URL(folder, import.meta.url);
  return readdirSync(url)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(new URL(file, url), 'utf8')).id);
});

test('every component that can get busy has something to try', () => {
  for (const { id, capacity } of COMPONENT_KINDS) {
    if (capacity) assert.ok(fixesFor(id).length > 0, `${id} has no fixes`);
  }
});

test('every fix says why, and either acts or links to a board that exists', () => {
  for (const { id } of COMPONENT_KINDS) {
    for (const fix of fixesFor(id)) {
      assert.ok(fix.title && fix.why, id);
      assert.ok(fix.action || fix.board, `${id}: "${fix.title}" leads nowhere`);
      if (fix.action) assert.equal(fix.action, 'add-copy');
      if (fix.board) assert.ok(boardIds.includes(fix.board), fix.board);
    }
  }
});

test('a SQL database is never told to just add a copy', () => {
  // Writes can't be shared between copies: it needs a cache or a replica.
  const actions = fixesFor('sql-database').map((fix) => fix.action);
  assert.ok(!actions.includes('add-copy'));
});
