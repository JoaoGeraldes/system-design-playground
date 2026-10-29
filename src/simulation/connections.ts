import { findKind } from '../content/components.ts';
import rules from '../content/connectionRules.json' with { type: 'json' };

/** Why a cable looks wrong, and what to do about it. */
export interface ConnectionAdvice {
  problem: string;
  suggestion: string;
  /** True when turning the cable round would fix it. */
  flip: boolean;
}

interface Rule {
  /** Component kinds or categories. */
  from: string[];
  to: string[];
  problem: string;
  suggestion: string;
  flip?: boolean;
}

const RULES = rules as Rule[];

function matches(kind: string, names: string[]): boolean {
  return names.includes(kind) || names.includes(findKind(kind).category);
}

/**
 * What's wrong with a cable that carries traffic from one kind of component
 * to another, or undefined when it looks fine. Only well-known mistakes are
 * flagged, so new structures are free to try.
 */
export function adviseConnection(
  fromKind: string,
  toKind: string,
): ConnectionAdvice | undefined {
  const rule = RULES.find(
    (candidate) =>
      matches(fromKind, candidate.from) && matches(toKind, candidate.to),
  );
  if (!rule) return undefined;
  const { problem, suggestion, flip = false } = rule;
  return { problem, suggestion, flip };
}
