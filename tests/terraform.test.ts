import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPONENT_KINDS } from '../src/content/components.ts';
import { Design } from '../src/model/design.ts';
import {
  TERRAFORM_TARGETS,
  toTerraform,
  type TerraformTarget,
} from '../src/model/terraform.ts';

function board(nodes: Record<string, string>, cables: string[]): Design {
  const design = new Design();
  const ids = new Map<string, string>();
  Object.entries(nodes).forEach(([name, kind], i) => {
    ids.set(name, design.addNode(kind, { x: i * 300, y: 0 }, name).id);
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

test('every component can be exported to every target without error', () => {
  for (const { id: target } of TERRAFORM_TARGETS) {
    for (const { id } of COMPONENT_KINDS) {
      const text = toTerraform(board({ one: id }, []), target).text;
      assert.ok(text.includes('provider'), `${target} ${id}`);
    }
  }
});

test('an AWS design becomes AWS resources, with the variables they need', () => {
  const { text, warnings } = toTerraform(
    board({ user: 'client', web: 'app-server', db: 'sql-database' }, [
      'user>web',
      'web>db',
    ]),
    'aws',
  );
  assert.match(text, /resource "aws_instance" "web"/);
  assert.match(text, /resource "aws_db_instance" "db"/);
  assert.match(text, /variable "db_password"/);
  assert.match(text, /variable "region"/);
  assert.match(text, /# web -> db/);
  assert.doesNotMatch(text, /resource "[a-z_]+" "user"/);
  assert.deepEqual(warnings, []);
});

test('a Railway design becomes services, wired together over the private network', () => {
  const { text } = toTerraform(
    board({ web: 'app-server', db: 'sql-database' }, ['web>db']),
    'railway',
  );
  assert.match(text, /resource "railway_service" "web"/);
  assert.match(text, /source_image = "postgres:16"/);
  assert.match(text, /name\s+= "DB_URL"/);
  assert.match(text, /railway_service\.db\.name\}\.railway\.internal/);
});

test('components with no equivalent are commented and reported', () => {
  const { text, warnings } = toTerraform(
    board({ lb: 'load-balancer' }, []),
    'railway',
  );
  assert.match(text, /# lb: Railway balances traffic/);
  assert.equal(warnings.length, 1);
});

test('two components with the same name get different identifiers', () => {
  const design = board({ web: 'app-server' }, []);
  design.addNode('app-server', { x: 0, y: 200 }, 'web');
  const { text } = toTerraform(design, 'aws');
  assert.match(text, /"aws_instance" "web"/);
  assert.match(text, /"aws_instance" "web_2"/);
});

test('names Terraform would reject are tidied', () => {
  const design = new Design();
  design.addNode('cache', { x: 0, y: 0 }, '2nd Cache (EU)');
  const { text } = toTerraform(design, 'aws' as TerraformTarget);
  assert.match(text, /"aws_elasticache_cluster" "c_2nd_cache_eu"/);
  assert.match(text, /cluster_id\s+= "c-2nd-cache-eu"/);
});
