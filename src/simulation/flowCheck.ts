import { findKind } from '../content/components.ts';
import type { Design } from '../model/design.ts';
import { adviseConnection } from './connections.ts';
import { fixesFor } from './fixes.ts';
import { AVERAGE_DAY, computeLoad, type Scenario } from './load.ts';

export interface FlowIssue {
  /**
   * Error: it's broken. Warning: it works, but something is off. Suggestion:
   * everything is fine and there's a better option.
   */
  level: 'error' | 'warning' | 'suggestion';
  title: string;
  /** What's going on, in plain words. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** The component to point at, when there is one. */
  nodeId?: string;
}

export interface FlowReport {
  /** True when every user is served and nothing is broken. */
  works: boolean;
  issues: FlowIssue[];
}

export type FlowStatus = 'error' | 'warning' | 'suggestion' | 'ok';

/** The most serious thing the report found, or 'ok' when it found nothing. */
export function flowStatus(report: FlowReport): FlowStatus {
  for (const level of ['error', 'warning', 'suggestion'] as const) {
    if (report.issues.some((issue) => issue.level === level)) return level;
  }
  return 'ok';
}

const DATA_KINDS = new Set([
  'sql-database',
  'nosql-database',
  'object-storage',
]);

/** Checks whether a design works for the day being simulated, and why not. */
export function checkFlow(
  design: Design,
  scenario: Scenario = AVERAGE_DAY,
): FlowReport {
  const issues: FlowIssue[] = [];
  const nameOf = (id: string) => {
    const node = design.getNode(id);
    return node.label ?? findKind(node.kind).label;
  };
  const clients = design.nodes.filter((node) => node.kind === 'client');

  if (clients.length === 0) {
    issues.push({
      level: 'error',
      title: 'Nobody uses this yet',
      why: 'Traffic starts at a Client, and the board has none.',
      fix: 'Add a Client and connect it to your first server.',
    });
    return { works: false, issues };
  }

  const load = computeLoad(design, scenario);
  const reached = reachableFromClients(design);

  for (const client of clients) {
    const name = nameOf(client.id);
    if (
      !design.cablesOf(client.id).some(({ from }) => from.nodeId === client.id)
    ) {
      issues.push({
        level: 'error',
        title: `${name} isn't connected to anything`,
        why: 'Its requests have nowhere to go, so these users get nothing.',
        fix: 'Drag from its dot to a server, load balancer or gateway.',
        nodeId: client.id,
      });
      continue;
    }
    const health = load.health.get(client.id);
    const weakestId = load.weakestLink.get(client.id);
    if (!health || health === 'fast' || !weakestId) continue;
    const weakest = nameOf(weakestId);
    const [best] = fixesFor(design.getNode(weakestId).kind);
    const fix = best ? `${best.title}. ${best.why}` : 'Give it more capacity.';
    const outcome = {
      failing: {
        level: 'error' as const,
        title: `${name}: some requests fail`,
        why: `The ${weakest} is too busy, so it drops requests.`,
      },
      slow: {
        level: 'warning' as const,
        title: `${name}: answers are slow`,
        why: `The ${weakest} is nearly full, so everything waiting on it slows down.`,
      },
      delayed: {
        level: 'warning' as const,
        title: `${name}: background work falls behind`,
        why: `Users get answers, but the ${weakest} can't keep up with its tasks.`,
      },
    }[health];
    issues.push({ ...outcome, fix, nodeId: weakestId });
  }

  for (const cable of design.cables) {
    const from = design.getNode(cable.from.nodeId);
    const to = design.getNode(cable.to.nodeId);
    const advice = adviseConnection(from.kind, to.kind);
    if (!advice) continue;
    issues.push({
      level: 'error',
      title: `${nameOf(from.id)} → ${nameOf(to.id)} looks wrong`,
      why: advice.problem,
      fix: advice.suggestion,
      nodeId: from.id,
    });
  }

  for (const node of design.nodes) {
    if (node.kind === 'client' || reached.has(node.id)) continue;
    issues.push({
      level: 'warning',
      title: `${nameOf(node.id)} never gets traffic`,
      why: 'No path of cables leads to it from a client, so it does nothing.',
      fix: 'Connect it to something that receives requests, or remove it.',
      nodeId: node.id,
    });
  }

  const storesData = [...reached].some((id) =>
    DATA_KINDS.has(design.getNode(id).kind),
  );
  const hasServer = [...reached].some(
    (id) => design.getNode(id).kind === 'app-server',
  );
  if (hasServer && !storesData) {
    issues.push({
      level: 'suggestion',
      title: 'Nothing remembers anything',
      why: 'Your servers have no database or storage, so data is lost whenever one restarts.',
      fix: 'Add a SQL Database and connect your server to it.',
    });
  }

  const servers = [...reached].filter(
    (id) => design.getNode(id).kind === 'app-server',
  );
  const sharesTraffic = [...reached].some(
    (id) => design.getNode(id).kind === 'load-balancer',
  );
  if (servers.length === 1 && !sharesTraffic) {
    issues.push({
      level: 'suggestion',
      title: 'One server is a single point of failure',
      why: 'If it breaks, everything stops, and it can only grow so big.',
      fix: 'Add a copy of the server behind a load balancer.',
      nodeId: servers[0],
    });
  }

  return { works: !issues.some(({ level }) => level === 'error'), issues };
}

/** Every component a client's traffic can reach by following the cables. */
function reachableFromClients(design: Design): Set<string> {
  const seen = new Set<string>();
  const stack = design.nodes
    .filter((node) => node.kind === 'client')
    .map((node) => node.id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const { from, to } of design.cables) {
      if (from.nodeId !== id || seen.has(to.nodeId)) continue;
      seen.add(to.nodeId);
      stack.push(to.nodeId);
    }
  }
  return seen;
}
