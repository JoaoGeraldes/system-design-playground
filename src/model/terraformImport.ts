import { Design } from './design.ts';
import { tidyUp } from './layout.ts';
import { ALL_MAPPINGS } from './terraform.ts';
import { toTemplate, type Template } from './templates.ts';

export interface TerraformImport {
  board: Template;
  /** Things that didn't map cleanly, so nothing is silently dropped. */
  notes: string[];
}

interface Resource {
  type: string;
  name: string;
  body: string;
}

/** Kinds that take a client's traffic first, so the clients go in front of them. */
const ENTRY_KINDS = [
  'dns',
  'cdn',
  'load-balancer',
  'api-gateway',
  'websocket-gateway',
];

/**
 * Reads Terraform text (AWS or Railway resources) into a board: each
 * resource it recognises becomes a component, references between resources
 * and the "# caller -> callee" lines this app writes become cables, and
 * anything else becomes an External Service. Modules, remote state and
 * heredoc strings are not followed.
 */
export function parseTerraform(
  text: string,
): TerraformImport | { error: string } {
  const resources = findResources(stripComments(text));
  if (resources.length === 0) {
    return { error: 'It has no resource blocks, so there is nothing to show.' };
  }

  const notes: string[] = [];
  const design = new Design();
  const nodeOf = new Map<string, string>();
  for (const resource of resources) {
    if (isIgnored(resource.type)) continue;
    const kind = kindOf(resource);
    if (!kind)
      notes.push(
        `${resource.type}.${resource.name} has no equivalent here, so it is shown as an External Service.`,
      );
    const node = design.addNode(
      kind ?? 'external-service',
      { x: 0, y: 0 },
      labelFrom(resource.name),
    );
    nodeOf.set(`${resource.type}.${resource.name}`, node.id);
  }
  if (design.nodes.length === 0) {
    return {
      error:
        'It only has supporting resources (networks, variables), no components.',
    };
  }

  const connect = (from: string | undefined, to: string | undefined) => {
    if (!from || !to || from === to) return;
    design.connect(
      { nodeId: from, side: 'right' },
      { nodeId: to, side: 'left' },
    );
  };
  for (const resource of resources) {
    const from = nodeOf.get(`${resource.type}.${resource.name}`);
    const variableTarget = variableOwner(resource);
    if (variableTarget) {
      // A Railway variable says one service uses another.
      const owner = nodeOf.get(variableTarget.owner);
      for (const used of references(
        resource.body,
        nodeOf,
        variableTarget.owner,
      )) {
        connect(owner, used);
      }
      continue;
    }
    for (const used of references(
      resource.body,
      nodeOf,
      `${resource.type}.${resource.name}`,
    )) {
      connect(from, used);
    }
  }
  for (const [caller, callee] of connectionComments(text)) {
    const byName = (name: string) =>
      [...nodeOf.entries()].find(([key]) => key.endsWith(`.${name}`))?.[1];
    connect(byName(caller), byName(callee));
  }

  const entries = design.nodes.filter(
    (node) =>
      ENTRY_KINDS.includes(node.kind) &&
      !design.cables.some((cable) => cable.to.nodeId === node.id),
  );
  const fronts =
    entries.length > 0
      ? entries
      : design.nodes.filter(
          (node) => !design.cables.some((cable) => cable.to.nodeId === node.id),
        );
  const users = design.addNode('client', { x: 0, y: 0 }, 'Users');
  for (const front of fronts) connect(users.id, front.id);

  tidyUp(design);
  const board = toTemplate(design);
  return {
    board: { ...board, id: 'imported', title: 'Terraform', summary: '' },
    notes,
  };
}

function isIgnored(type: string): boolean {
  return ALL_MAPPINGS.some((mapping) => mapping.ignoredTypes?.includes(type));
}

/** The component kind a resource stands for, or undefined when unknown. */
function kindOf({ type, body }: Resource): string | undefined {
  const text = body.toLowerCase();
  for (const mapping of ALL_MAPPINGS) {
    const hint = mapping.importHints?.find(
      (candidate) =>
        candidate.type === type && text.includes(candidate.match.toLowerCase()),
    );
    if (hint) return hint.kind;
  }
  for (const mapping of ALL_MAPPINGS) {
    for (const [kind, { block }] of Object.entries(mapping.kinds)) {
      if (block?.some((line) => line.includes(`resource "${type}"`)))
        return kind;
    }
  }
  return undefined;
}

/** "web_2" becomes "Web 2". */
function labelFrom(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** A Railway variable names its service in `service_id`; null for others. */
function variableOwner({ type, body }: Resource): { owner: string } | null {
  if (type !== 'railway_variable') return null;
  const match = /service_id\s*=\s*(railway_service\.\w+)\.id/.exec(body);
  return match ? { owner: match[1] } : null;
}

/** Resources a body refers to, as node ids, other than `self`. */
function references(
  body: string,
  nodeOf: Map<string, string>,
  self: string,
): string[] {
  const found: string[] = [];
  for (const [key, id] of nodeOf) {
    if (key === self) continue;
    if (new RegExp(`\\b${key.replace('.', '\\.')}\\b`).test(body))
      found.push(id);
  }
  return found;
}

/** `# caller -> callee` lines, the way this app writes connections. */
function connectionComments(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const match of text.matchAll(
    /^#\s*([A-Za-z_][\w-]*)\s*->\s*([A-Za-z_][\w-]*)\s*$/gm,
  )) {
    pairs.push([match[1], match[2]]);
  }
  return pairs;
}

/** The text without its comments; strings are left alone. */
function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '"') {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function findResources(text: string): Resource[] {
  const resources: Resource[] = [];
  const header = /\bresource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  for (let match = header.exec(text); match; match = header.exec(text)) {
    const start = match.index + match[0].length;
    const end = closingBrace(text, start);
    resources.push({
      type: match[1],
      name: match[2],
      body: text.slice(start, end),
    });
    header.lastIndex = end;
  }
  return resources;
}

/** The index of the `}` that closes a block whose body starts at `from`. */
function closingBrace(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length;) {
    const c = text[i];
    if (c === '"') i = skipString(text, i);
    else {
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return i;
      i++;
    }
  }
  return text.length;
}

/** Past the quote that closes the string starting at `from`. */
function skipString(text: string, from: number): number {
  let i = from + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === '$' && text[i + 1] === '{')
      i = skipInterpolation(text, i + 2);
    else if (c === '"') return i + 1;
    else i++;
  }
  return i;
}

function skipInterpolation(text: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < text.length && depth > 0) {
    if (text[i] === '"') i = skipString(text, i);
    else {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      i++;
    }
  }
  return i;
}
