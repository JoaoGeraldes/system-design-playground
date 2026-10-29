import type { Camera } from './camera.ts';
import { categoryColor, findKind } from '../content/components.ts';
import {
  BUSY_AT,
  describeUsers,
  usersOf,
  type Health,
  type LoadReport,
  type NodeLoad,
} from '../simulation/load.ts';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  SIDES,
  portPosition,
  type Cable,
  type Design,
  type DesignNode,
  type Group,
  type PortRef,
} from '../model/design.ts';
import {
  displaceCurve,
  displacementAt,
  pointAlong,
  polylineLength,
  smoothCurve,
  waveAt,
  type FlowSettings,
} from './flow.ts';
import type { Point } from '../model/geometry.ts';
import type { Rope } from '../model/rope.ts';
import { PORT_RADIUS } from './snap.ts';

const GRID_DOT = '#2a2a2a';
const GRID_SPACING = 24;
const CABLE_SHADOW = 'rgba(0, 0, 0, 0.55)';
// The canvas uses the page's fonts and colours, defined once in style.css.
const rootStyle = getComputedStyle(document.documentElement);
const FONT_UI = rootStyle.getPropertyValue('--font-ui');
const FONT_MONO = rootStyle.getPropertyValue('--font-mono');
const BACKGROUND = rootStyle.getPropertyValue('--bg').trim();
const TEXT = rootStyle.getPropertyValue('--text').trim();
const MUTED = rootStyle.getPropertyValue('--muted').trim();
const ACCENT = rootStyle.getPropertyValue('--accent').trim();
// How fast a selected group's dashes travel round it, in board units a second.
const MARCHING_SPEED = 16;
// Moving borders are skipped for people who ask for less motion.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** Size of a group's resize handles, in screen pixels. */
export const GROUP_CORNER_RADIUS = 9;
const NODE_FILL = rootStyle.getPropertyValue('--surface-node').trim();
// Group outlines and label pills: quiet lines on the board.
const SUBTLE_LINE = '#3a3a3a';
// Load and health colours, the same ones the legend uses.
const LOAD_FINE = rootStyle.getPropertyValue('--status-fine').trim();
const LOAD_BUSY = rootStyle.getPropertyValue('--status-busy').trim();
const LOAD_OVER = rootStyle.getPropertyValue('--status-over').trim();
// Each health state has its own colour and its own symbol, so it reads
// without relying on colour alone.
const HEALTH_DOT: Record<Health, { color: string; symbol: string }> = {
  fast: { color: LOAD_FINE, symbol: '✓' },
  slow: { color: LOAD_BUSY, symbol: '!' },
  failing: { color: LOAD_OVER, symbol: '✕' },
  delayed: { color: LOAD_BUSY, symbol: '…' },
};

/** Groups have no ids, so a selected group's `id` is its index. */
export type Selection = { type: 'node' | 'cable' | 'group'; id: string };

export interface CableDraft {
  /** The end that stays plugged in while the other one is dragged. */
  from: PortRef;
  rope: Rope;
  snap: PortRef | null;
  /** Set when an existing cable was pulled out and is being re-plugged. */
  unplugged?: { label?: string; oneWay?: boolean; reversed: boolean };
}

export interface Scene {
  design: Design;
  camera: Camera;
  selection: Selection | null;
  hoveredNodeId: string | null;
  /** The group whose title strip is hovered or held, as an index. */
  hoveredGroup: number | null;
  hoveredPort: PortRef | null;
  draft: CableDraft | null;
  /** The area being dragged out for a new group. */
  groupDraft: Group | null;
  /**
   * Whose wheel is open, as "type:id". Wheels open on a click, not on
   * every selection, so dragging something doesn't pop one up.
   */
  openWheel: string | null;
  /** How busy each component is, while traffic is shown. */
  load: LoadReport | null;
  /** The group showing corner handles for resizing, as an index. */
  resizingGroup: number | null;
  flow: FlowSettings;
  /** Seconds since the page loaded; drives the flow animation. */
  time: number;
}

export function render(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  size: { width: number; height: number; pixelRatio: number },
): void {
  const { camera } = scene;
  const ratio = size.pixelRatio;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.setTransform(
    ratio * camera.scale,
    0,
    0,
    ratio * camera.scale,
    ratio * camera.x,
    ratio * camera.y,
  );
  drawGrid(ctx, camera, size);
  scene.design.groups.forEach((group, index) => {
    const selected = isSelected(scene, 'group', String(index));
    const lit = selected || scene.hoveredGroup === index;
    // While its wheel is open, a group's dashes march around it.
    const marching = selected && scene.openWheel === `group:${index}`;
    const dashOffset =
      marching && !reducedMotion.matches ? -scene.time * MARCHING_SPEED : 0;
    drawGroup(ctx, group, lit, dashOffset);
    if (scene.resizingGroup === index) {
      drawCornerHandles(ctx, group, camera.scale);
    }
  });
  if (scene.groupDraft) drawGroup(ctx, scene.groupDraft, true);
  for (const cable of scene.design.cables) {
    const selected = isSelected(scene, 'cable', cable.id);
    const curve = cableCurve(cable, scene.flow, scene.time);
    drawCable(ctx, scene.design, cable, curve, selected);
    drawDirectionArrows(ctx, curve, cable.label, !cable.oneWay);
  }
  for (const cable of scene.design.cables) drawCableLabel(ctx, cable);
  for (const node of scene.design.nodes) {
    drawNode(ctx, node, {
      selected: isSelected(scene, 'node', node.id),
      hovered: scene.hoveredNodeId === node.id,
      load: scene.load?.nodes.get(node.id),
      health: scene.load?.health.get(node.id),
    });
  }
  drawPorts(ctx, scene);
  if (scene.draft) drawDraft(ctx, scene.design, scene.draft);

  if (scene.design.nodes.length === 0) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawEmptyState(ctx, size);
  }
}

function isSelected(scene: Scene, type: Selection['type'], id: string) {
  return scene.selection?.type === type && scene.selection.id === id;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  size: { width: number; height: number },
): void {
  const left = -camera.x / camera.scale;
  const top = -camera.y / camera.scale;
  const right = left + size.width / camera.scale;
  const bottom = top + size.height / camera.scale;
  const startX = Math.floor(left / GRID_SPACING) * GRID_SPACING;
  const startY = Math.floor(top / GRID_SPACING) * GRID_SPACING;
  const dotSize = 1.6 / camera.scale;

  ctx.fillStyle = GRID_DOT;
  for (let x = startX; x <= right; x += GRID_SPACING) {
    for (let y = startY; y <= bottom; y += GRID_SPACING) {
      ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
    }
  }
}

function nodeColor(node: DesignNode): string {
  return categoryColor(findKind(node.kind).category);
}

/**
 * The cable's smooth curve, bent by any wave currently running along it:
 * requests ripple from → to, responses ripple back.
 */
function cableCurve(cable: Cable, flow: FlowSettings, seconds: number) {
  const curve = smoothCurve(cable.rope.points);
  const length = polylineLength(curve);
  if (cable.oneWay) flow = { ...flow, showResponses: false };
  const wave = waveAt(length, seconds, flow, phaseOf(cable.id));
  if (!wave) return curve;
  return displaceCurve(curve, (position) =>
    displacementAt(position, length, wave, flow),
  );
}

/** Spreads cables over a few seconds so they don't all ripple at once. */
function phaseOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return (hash / 9973) * 4;
}

function drawCable(
  ctx: CanvasRenderingContext2D,
  design: Design,
  cable: Cable,
  curve: Point[],
  selected: boolean,
): void {
  const fromColor = nodeColor(design.getNode(cable.from.nodeId));
  const toColor = nodeColor(design.getNode(cable.to.nodeId));
  drawRope(ctx, curve, fromColor, toColor, selected);
}

function drawDraft(
  ctx: CanvasRenderingContext2D,
  design: Design,
  draft: CableDraft,
): void {
  const fromColor = nodeColor(design.getNode(draft.from.nodeId));
  const toColor = draft.snap
    ? nodeColor(design.getNode(draft.snap.nodeId))
    : fromColor;
  drawRope(ctx, smoothCurve(draft.rope.points), fromColor, toColor, false);
}

function drawRope(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  fromColor: string,
  toColor: string,
  selected: boolean,
): void {
  const start = points[0];
  const end = points[points.length - 1];
  const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, fromColor);
  gradient.addColorStop(1, toColor);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (selected) {
    traceRope(ctx, points);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 12;
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(0, 3);
  traceRope(ctx, points);
  ctx.strokeStyle = CABLE_SHADOW;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.restore();

  traceRope(ctx, points);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = selected ? 4 : 3;
  ctx.stroke();

  drawPlug(ctx, start, fromColor);
  drawPlug(ctx, end, toColor);
}

function traceRope(ctx: CanvasRenderingContext2D, curve: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(curve[0].x, curve[0].y);
  for (const point of curve.slice(1)) ctx.lineTo(point.x, point.y);
}

function drawPlug(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, PORT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BACKGROUND;
  ctx.stroke();
}

/** A dashed area; when grabbable (hovered), it brightens to say so. */
function drawGroup(
  ctx: CanvasRenderingContext2D,
  group: Group,
  hovered: boolean,
  dashOffset = 0,
): void {
  ctx.beginPath();
  ctx.roundRect(group.x, group.y, group.width, group.height, 16);
  ctx.fillStyle = hovered
    ? 'rgba(255, 255, 255, 0.04)'
    : 'rgba(255, 255, 255, 0.02)';
  ctx.fill();
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = dashOffset;
  ctx.lineWidth = hovered ? 2 : 1.5;
  ctx.strokeStyle = hovered ? MUTED : SUBTLE_LINE;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = hovered ? TEXT : MUTED;
  ctx.font = `600 13px ${FONT_UI}`;
  ctx.fillText(group.label.toUpperCase(), group.x + 14, group.y + 12);
}

/** Round handles on a group's corners, the same size at any zoom. */
function drawCornerHandles(
  ctx: CanvasRenderingContext2D,
  { x, y, width, height }: Group,
  scale: number,
): void {
  const radius = GROUP_CORNER_RADIUS / scale;
  for (const corner of [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ]) {
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = BACKGROUND;
    ctx.stroke();
  }
}

/**
 * Chevrons showing which way a cable sends traffic: one for a one-way cable,
 * one each way for a two-way cable (requests out, responses back).
 */
function drawDirectionArrows(
  ctx: CanvasRenderingContext2D,
  curve: Point[],
  label: string | undefined,
  twoWay: boolean,
): void {
  if (!twoWay) {
    // The middle belongs to the label, so the arrow steps aside for it.
    drawChevron(ctx, curve, label ? 0.3 : 0.5, false);
    return;
  }
  drawChevron(ctx, curve, 0.35, false);
  drawChevron(ctx, curve, 0.65, true);
}

function drawChevron(
  ctx: CanvasRenderingContext2D,
  curve: Point[],
  along: number,
  backwards: boolean,
): void {
  const { point, angle } = pointAlong(curve, along);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(backwards ? angle + Math.PI : angle);
  ctx.beginPath();
  ctx.moveTo(-4, -6);
  ctx.lineTo(4, 0);
  ctx.lineTo(-4, 6);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = BACKGROUND;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = TEXT;
  ctx.stroke();
  ctx.restore();
}

/** A small pill at the middle of the rope, so it moves with the cable. */
function drawCableLabel(ctx: CanvasRenderingContext2D, cable: Cable): void {
  if (!cable.label) return;
  const { points } = cable.rope;
  const middle = points[Math.floor(points.length / 2)];

  ctx.font = `500 13px ${FONT_UI}`;
  const width = ctx.measureText(cable.label).width + 14;
  const height = 20;
  ctx.beginPath();
  ctx.roundRect(middle.x - width / 2, middle.y - height / 2, width, height, 10);
  ctx.fillStyle = 'rgba(18, 18, 18, 0.92)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = SUBTLE_LINE;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT;
  ctx.fillText(cable.label, middle.x, middle.y + 0.5);
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: DesignNode,
  state: {
    selected: boolean;
    hovered: boolean;
    load?: NodeLoad;
    health?: Health;
  },
): void {
  const kind = findKind(node.kind);
  const color = categoryColor(kind.category);
  const left = node.x - NODE_WIDTH / 2;
  const top = node.y - NODE_HEIGHT / 2;
  const ratio = state.load?.ratio ?? 0;
  const overloaded = ratio > 1;
  const busy = !overloaded && ratio >= BUSY_AT;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.beginPath();
  ctx.roundRect(left, top, NODE_WIDTH, NODE_HEIGHT, 10);
  ctx.fillStyle = NODE_FILL;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.roundRect(left, top, NODE_WIDTH, NODE_HEIGHT, 10);
  ctx.lineWidth = state.selected || overloaded ? 2 : 1;
  ctx.strokeStyle = overloaded
    ? LOAD_OVER
    : state.selected
      ? color
      : // Strong enough to see each component's edge (3 : 1 or more).
        withAlpha(color, state.hovered ? 0.85 : 0.6);
  ctx.stroke();

  const badgeSize = 32;
  const badgeLeft = left + 10;
  const badgeTop = node.y - badgeSize / 2;
  ctx.beginPath();
  ctx.roundRect(badgeLeft, badgeTop, badgeSize, badgeSize, 7);
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = `700 12px ${FONT_MONO}`;
  ctx.fillText(kind.badge, badgeLeft + badgeSize / 2, node.y + 0.5);

  if (state.health) {
    drawHealthDot(ctx, left + NODE_WIDTH - 20, node.y, state.health);
  }

  ctx.textAlign = 'left';
  const textLeft = badgeLeft + badgeSize + 10;
  // Leave room for the health dot on clients.
  const textRight = left + NODE_WIDTH - (state.health ? 36 : 10);
  const textWidth = textRight - textLeft;
  ctx.fillStyle = TEXT;
  ctx.font = `600 15px ${FONT_UI}`;
  const title = fitText(ctx, node.label ?? kind.label, textWidth);
  ctx.fillText(title, textLeft, node.y - 8);

  // Load speaks in words too, so it never relies on colour alone.
  const [caption, captionColor] = overloaded
    ? ['Too busy', LOAD_OVER]
    : busy
      ? ['Busy', LOAD_BUSY]
      : node.kind === 'client'
        ? [describeUsers(usersOf(node)), MUTED]
        : // A custom name ("Primary DB") keeps the type as its caption.
          [node.label ? kind.label : kind.category, MUTED];
  ctx.fillStyle = captionColor;
  ctx.font = `500 13px ${FONT_UI}`;
  ctx.fillText(fitText(ctx, caption, textWidth), textLeft, node.y + 11);

  if (state.load) drawLoadBar(ctx, left, node.y + NODE_HEIGHT / 2 - 5, ratio);
}

/** A client's health: a coloured dot holding its own symbol. */
function drawHealthDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  health: Health,
): void {
  const { color, symbol } = HEALTH_DOT[health];
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BACKGROUND;
  ctx.font = `700 13px ${FONT_UI}`;
  ctx.fillText(symbol, x, y + 0.5);
}

/** A slim bar along the bottom of a component: how full it is. */
function drawLoadBar(
  ctx: CanvasRenderingContext2D,
  left: number,
  y: number,
  ratio: number,
): void {
  const width = NODE_WIDTH - 20;
  ctx.beginPath();
  ctx.roundRect(left + 10, y - 1.5, width, 3, 1.5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();
  ctx.beginPath();
  // A sliver always shows, so even a quiet component reads as "in use".
  const filled = Math.max(4, width * Math.min(ratio, 1));
  ctx.roundRect(left + 10, y - 1.5, filled, 3, 1.5);
  ctx.fillStyle =
    ratio > 1 ? LOAD_OVER : ratio >= BUSY_AT ? LOAD_BUSY : LOAD_FINE;
  ctx.fill();
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened.trimEnd()}…`;
}

/**
 * Ports appear on the hovered component, and on every component the
 * cable being drawn could plug into.
 */
function drawPorts(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { design, draft } = scene;
  for (const node of design.nodes) {
    const acceptsDraft =
      draft !== null &&
      node.id !== draft.from.nodeId &&
      !design.areConnected(draft.from.nodeId, node.id);
    if (!acceptsDraft && scene.hoveredNodeId !== node.id) continue;

    const color = nodeColor(node);
    for (const side of SIDES) {
      const port = { nodeId: node.id, side };
      const position = portPosition(node, side);
      const snapped = samePort(draft?.snap, port);
      const hovered = samePort(scene.hoveredPort, port);
      drawPort(ctx, position, color, { active: snapped || hovered });
      if (snapped) drawSnapRing(ctx, position, color);
    }
  }
}

function drawPort(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
  state: { active: boolean },
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, PORT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = state.active ? color : BACKGROUND;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawSnapRing(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
): void {
  const pulse = (Math.sin(performance.now() / 120) + 1) / 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, PORT_RADIUS + 5 + pulse * 3, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(color, 0.5);
  ctx.stroke();
}

function drawEmptyState(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = MUTED;
  ctx.font = `500 18px ${FONT_UI}`;
  ctx.fillText(
    'Click or drag a component to start building',
    size.width / 2,
    size.height / 2,
  );
}

function samePort(a: PortRef | null | undefined, b: PortRef): boolean {
  return a?.nodeId === b.nodeId && a.side === b.side;
}

function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
