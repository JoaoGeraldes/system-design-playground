import {
  fitCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './board/camera.ts';
import { renderComponentInfo } from './ui/componentInfo.ts';
import { renderClientFix, renderComponentFix } from './ui/fixCard.ts';
import { describeStatus } from './simulation/status.ts';
import { findKind } from './content/components.ts';
import {
  Design,
  GROUP_HANDLE_HEIGHT,
  NODE_HEIGHT,
  type PortRef,
} from './model/design.ts';
import { rectBetween, type Point } from './model/geometry.ts';
import { UndoHistory } from './model/history.ts';
import { tidyUp } from './model/layout.ts';
import {
  toTerraform,
  TERRAFORM_TARGETS,
  type TerraformTarget,
} from './model/terraform.ts';
import { parseTerraform } from './model/terraformImport.ts';
import { boardToPng } from './board/exportImage.ts';
import { createFlowPanel } from './ui/flowPanel.ts';
import { createAdvice } from './ui/advice.ts';
import { adviseConnection } from './simulation/connections.ts';
import { checkFlow } from './simulation/flowCheck.ts';
import { createCableToolbar } from './ui/cableToolbar.ts';
import { createLabelEditor } from './ui/labelEditor.ts';
import {
  AVERAGE_DAY,
  BUSY_AT,
  computeLoad,
  WORST_DAY,
  describeUsers,
  usersOf,
  USER_LEVELS,
} from './simulation/load.ts';
import { renderLesson } from './ui/lesson.ts';
import { renderNutshell } from './ui/nutshell.ts';
import { DRAG_FORMAT, renderPalette } from './ui/palette.ts';
import {
  GROUP_CORNER_RADIUS,
  render,
  type CableDraft,
  type Scene,
} from './board/render.ts';
import { createWheelPlacement, layoutRadialMenu } from './ui/radialMenu.ts';
import { createRope, reverseRope, stepRope } from './model/rope.ts';
import settings from './content/settings.json' with { type: 'json' };
import { findSnapTarget, portAt } from './board/snap.ts';
import { SECTIONS, type TemplateSection } from './content/templateLibrary.ts';
import {
  loadTemplate,
  parseBoard,
  toTemplate,
  type Template,
} from './model/templates.ts';

type Gesture =
  | { type: 'idle' }
  | { type: 'moving-node'; nodeId: string; grabOffset: Point; moved: boolean }
  | { type: 'drawing-cable' }
  | {
      type: 'holding-cable-end';
      cableId: string;
      end: 'from' | 'to';
      start: Point;
    }
  | {
      type: 'moving-group';
      index: number;
      // Captured when grabbed, so components it passes over stay behind.
      nodeIds: string[];
      last: Point;
      moved: boolean;
    }
  | { type: 'drawing-group'; start: Point }
  | {
      type: 'resizing-group';
      index: number;
      fixedCorner: Point;
      moved: boolean;
    }
  | { type: 'panning'; last: Point };

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const palette = document.querySelector<HTMLElement>('#palette')!;
const templateSelect =
  document.querySelector<HTMLSelectElement>('#template-select')!;
const drawer = document.querySelector<HTMLElement>('#drawer')!;
const drawerContent = document.querySelector<HTMLElement>('#drawer-content')!;
const drawerCloseButton = document.querySelector<HTMLElement>('#drawer-close')!;
const lessonOpenButton = document.querySelector<HTMLElement>('#lesson-open')!;
const terraformButton =
  document.querySelector<HTMLElement>('#export-terraform')!;
const terraformTarget =
  document.querySelector<HTMLSelectElement>('#terraform-target')!;
const exportPngButton = document.querySelector<HTMLElement>('#export-png')!;
const copyJsonButton = document.querySelector<HTMLElement>('#copy-json')!;
const flowToggle = document.querySelector<HTMLInputElement>('#flow-toggle')!;
const worstToggle = document.querySelector<HTMLInputElement>('#worst-toggle')!;
const legendWorst = document.querySelector<HTMLElement>('#legend-worst')!;
const labelInput = document.querySelector<HTMLInputElement>('#label-editor')!;
const menuToggle = document.querySelector<HTMLElement>('#menu-toggle')!;
const menuBackdrop = document.querySelector<HTMLElement>('#menu-backdrop')!;
const advice = createAdvice(document.querySelector<HTMLElement>('#advice')!);
const blankBoardButton = document.querySelector<HTMLElement>('#blank-board')!;
const tidyUpButton = document.querySelector<HTMLElement>('#tidy-up')!;
const addGroupButton = document.querySelector<HTMLElement>('#add-group')!;
const addGroupLabel = document.querySelector<HTMLElement>('#add-group-label')!;
const backToNutshellButton =
  document.querySelector<HTMLElement>('#back-to-nutshell')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
const shortcuts = document.querySelector<HTMLDetailsElement>('#shortcuts')!;
const legend = document.querySelector<HTMLDetailsElement>('#legend')!;
const nodeToolbar = document.querySelector<HTMLElement>('#node-toolbar')!;
const groupToolbar = document.querySelector<HTMLElement>('#group-toolbar')!;
layoutRadialMenu(nodeToolbar);
layoutRadialMenu(groupToolbar);
const placeGroupWheel = createWheelPlacement(groupToolbar.children.length);
const resizeButton = groupToolbar.querySelector<HTMLElement>(
  '[data-action="resize"]',
)!;
const placeNodeWheel = createWheelPlacement(nodeToolbar.children.length);
const usersButton = nodeToolbar.querySelector<HTMLElement>(
  '[data-action="users"]',
)!;
const usersPicker = document.querySelector<HTMLElement>('#users-picker')!;
const statusChip = document.querySelector<HTMLElement>('#status-chip')!;
const statusLabel = document.querySelector<HTMLElement>('#status-label')!;
const statusMeasure = document.querySelector<HTMLElement>('#status-measure')!;
const statusFigures = document.querySelector<HTMLElement>('#status-figures')!;
const statusDetail = document.querySelector<HTMLElement>('#status-detail')!;
const usersOptions = document.querySelector<HTMLElement>('#users-options')!;
const fixButton = nodeToolbar.querySelector<HTMLElement>(
  '[data-action="fix"]',
)!;
const nodeInfoButton = nodeToolbar.querySelector<HTMLElement>(
  '[data-action="info"]',
)!;
const nutshell = document.querySelector<HTMLElement>('#nutshell')!;
const nutshellOpenButton =
  document.querySelector<HTMLElement>('#nutshell-open')!;
const nutshellCloseButton =
  document.querySelector<HTMLElement>('#nutshell-close')!;
const toastMessage = document.querySelector<HTMLElement>('#toast-message')!;
const toastAction = document.querySelector<HTMLElement>('#toast-action')!;
const boardElement = document.querySelector<HTMLElement>('.board')!;
const dropZone = document.querySelector<HTMLElement>('#drop-zone')!;
const exportButton = document.querySelector<HTMLElement>('#export-board')!;
const importButton = document.querySelector<HTMLElement>('#import-board')!;
const importInput = document.querySelector<HTMLInputElement>('#import-file')!;
const cableToolbarElement =
  document.querySelector<HTMLElement>('#cable-toolbar')!;

// Space the drawer covers on the right of the board when open.
const DRAWER_SPACE = 472;
// Gap between the drawer and the bottom of the board on phones.
const DRAWER_GAP = 8;
// Physics steps run before showing a template, so cables appear settled.
const SETTLE_STEPS = 90;
// Each paste lands this far down and right of the last copy.
const PASTE_OFFSET = 40;
// A tap, rather than a drag, places a group this big.
const DEFAULT_GROUP_SIZE = { width: 420, height: 280 };
// Drags smaller than this count as a tap when drawing a group.
const MIN_GROUP_SIZE = 60;
// Room between the status chip and the wheel above it: the widest fans
// reach about this far below their centre.
const WHEEL_ABOVE_STATUS = 30;
// Each tap on a zoom button zooms this much.
const ZOOM_STEP = 1.25;
// How long a message stays; errors stay longer, so they can be read.
const TOAST_MS = 6000;
const ERROR_TOAST_MS = 10000;
// Holding still on a cable this long (touch screens) opens its label field.
const LONG_PRESS_MS = 500;
// Pointer travel (screen pixels) that turns a press into a drag.
const DRAG_SLOP = 6;

const design = new Design();
const undoHistory = new UndoHistory();
const scene: Scene = {
  design,
  camera: { x: 0, y: 0, scale: 1 },
  selection: null,
  hoveredNodeId: null,
  hoveredGroup: null,
  groupDraft: null,
  openWheel: null,
  load: null,
  resizingGroup: null,
  hoveredPort: null,
  draft: null,
  flow: { ...settings.flow },
  time: 0,
};
let gesture: Gesture = { type: 'idle' };
let pointer: Point = { x: 0, y: 0 };
let currentTemplate: Template | null = null;
let currentSection: TemplateSection | null = null;
let lessonOpen = true;
// What the drawer currently shows, so it is only rebuilt when that changes.
let drawerShowing = '';
let copied: {
  kind: string;
  label?: string;
  users?: number;
  x: number;
  y: number;
} | null = null;
let longPress: { timer: number; start: Point } | null = null;
let toastTimer = 0;
// The client whose "How many users?" picker is open.
let usersPickerFor: string | null = null;
// Whether the message's button undoes (or just dismisses the message).
let toastUndoes = false;
// While on, pressing the board draws a new group instead.
let groupMode = false;
// Where the pointer last pressed on the board (world units), so a wheel
// opens clear of it. Presses elsewhere, like the sidebar, don't count.
let lastPress: Point | null = null;
// What the drawer explains about the selected component, when asked:
// what it is (Info, or a double-click) or how to unclog it (Fix).
let drawerRequest: { nodeId: string; view: 'info' | 'fix' } | null = null;
// The Nutshell row a board was opened from, to land back on it.
let nutshellReturnRow: HTMLElement | null = null;

const labelEditor = createLabelEditor({
  input: labelInput,
  toScreen: (world) => worldToScreen(scene.camera, world),
});

function editCableLabel(cableId: string): void {
  const findCable = () => design.cables.find((cable) => cable.id === cableId);
  labelEditor.open({
    text: findCable()?.label ?? '',
    placeholder: 'Label this cable',
    position: () => {
      const points = findCable()?.rope.points;
      return points ? points[Math.floor(points.length / 2)] : null;
    },
    save: (label) => {
      const cable = findCable();
      if (!cable || (cable.label ?? '') === label.trim()) return;
      undoHistory.record(design);
      design.setCableLabel(cableId, label);
    },
  });
}

/** Opens the name field over a group's title, where its name is drawn. */
function editGroupName(groupIndex: number): void {
  labelEditor.open({
    text: design.groups[groupIndex].label,
    placeholder: 'Name this group',
    position: () => {
      const group = design.groups[groupIndex];
      // The field is centred, so half its width (100) lines it up left.
      return group
        ? { x: group.x + 114, y: group.y + GROUP_HANDLE_HEIGHT / 2 }
        : null;
    },
    save: (name) => {
      const group = design.groups[groupIndex];
      const trimmed = name.trim();
      // A group always keeps a name, so its title strip can be grabbed.
      if (!group || !trimmed || trimmed === group.label) return;
      undoHistory.record(design);
      design.renameGroup(groupIndex, trimmed);
    },
  });
}

/** In group mode the next press on the board draws a group. */
function setGroupMode(on: boolean): void {
  groupMode = on;
  addGroupButton.ariaPressed = String(on);
  addGroupLabel.textContent = on ? 'Drag or tap on the board' : 'Draw a group';
  if (!on) scene.groupDraft = null;
}
addGroupButton.addEventListener('click', () => setGroupMode(!groupMode));

tidyUpButton.addEventListener('click', () => {
  if (design.nodes.length === 0) return;
  undoHistory.record(design);
  tidyUp(design);
  fitToDesign();
  showToast('Tidied up', { undo: true });
});

function finishGroup(start: Point, end: Point): void {
  let area = rectBetween(start, end);
  if (area.width < MIN_GROUP_SIZE || area.height < MIN_GROUP_SIZE) {
    const { width, height } = DEFAULT_GROUP_SIZE;
    area = { x: start.x - width / 2, y: start.y - height / 2, width, height };
  }
  undoHistory.record(design);
  const index = design.addGroup({ label: 'Group', ...area });
  setGroupMode(false);
  editGroupName(index);
}

const cableToolbar = createCableToolbar({
  element: cableToolbarElement,
  design,
  toScreen: (world) => worldToScreen(scene.camera, world),
  actions: {
    setOneWay: (cableId, oneWay) => {
      if (Boolean(design.getCable(cableId).oneWay) === oneWay) return;
      undoHistory.record(design);
      design.setCableOneWay(cableId, oneWay);
    },
    flip: (cableId) => {
      undoHistory.record(design);
      design.flipCable(cableId);
    },
    label: (cableId) => editCableLabel(cableId),
    remove: () => deleteSelection(),
  },
});

renderPalette(palette, (kindId) => {
  setNutshellOpen(false);
  addAtViewCenter(kindId);
});
fillTemplateSelect();
renderNutshell(document.querySelector('#nutshell-content')!, (id, row) => {
  nutshellReturnRow = row;
  // A real history step, so the browser's Back button returns here too.
  history.pushState(null, '', `#${id}`);
  setNutshellOpen(false);
  openTemplate(id);
});

backToNutshellButton.addEventListener('click', () => history.back());

document
  .querySelector('#shortcuts-close')!
  .addEventListener('click', () => (shortcuts.open = false));

// Phones have no scroll wheel, so zooming gets buttons there.
document.querySelector('.zoom-controls')!.addEventListener('click', (event) => {
  const zoom = (event.target as HTMLElement).closest<HTMLElement>('[data-zoom]')
    ?.dataset.zoom;
  if (zoom === 'fit') return fitToDesign();
  if (!zoom) return;
  const { width, height } = visibleBoardSize();
  const factor = zoom === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP;
  const center = { x: width / 2, y: height / 2 };
  scene.camera = zoomAt(scene.camera, center, factor);
});

window.addEventListener('popstate', () => {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === 'nutshell') {
    setNutshellOpen(true);
    nutshellReturnRow?.scrollIntoView({ block: 'center' });
    nutshellReturnRow?.focus({ preventScroll: true });
    nutshellReturnRow = null;
    return;
  }
  setNutshellOpen(false);
  if (hash !== (currentTemplate?.id ?? '')) openTemplate(hash);
});

function fillTemplateSelect(): void {
  templateSelect.append(new Option('Blank board', ''));
  for (const { name, templates } of SECTIONS) {
    const group = document.createElement('optgroup');
    group.label = name;
    templates.forEach((template, index) => {
      group.append(new Option(`${index + 1}. ${template.title}`, template.id));
    });
    templateSelect.append(group);
  }
}

/**
 * Opens a template, or a blank board when `id` matches none. Only
 * clearing can be undone: undoing into an old board under a new template's
 * lesson would be confusing.
 */
function openTemplate(id: string): void {
  setGroupMode(false);
  currentSection =
    SECTIONS.find(({ templates }) =>
      templates.some((candidate) => candidate.id === id),
    ) ?? null;
  currentTemplate =
    currentSection?.templates.find((template) => template.id === id) ?? null;
  templateSelect.value = currentTemplate?.id ?? '';
  scene.selection = null;
  if (currentTemplate) {
    undoHistory.clear();
    loadTemplate(design, currentTemplate);
  } else {
    if (design.nodes.length > 0) {
      undoHistory.record(design);
      showToast('Board cleared', { undo: true });
    }
    design.clear();
  }
  presentBoard(currentTemplate ? `#${id}` : '#');
}

/** Lets the cables settle, then shows the board's lesson and fits it in view. */
function presentBoard(hash: string): void {
  for (let i = 0; i < SETTLE_STEPS; i++) design.step();
  syncDrawer();
  history.replaceState(null, '', hash);
  fitToDesign();
}

/** An imported board replaces the current one, as one undoable step. */
function showImportedBoard(board: Template): void {
  setNutshellOpen(false);
  setGroupMode(false);
  undoHistory.record(design);
  currentTemplate = null;
  currentSection = null;
  templateSelect.value = '';
  scene.selection = null;
  loadTemplate(design, board);
  presentBoard('#');
}

exportButton.addEventListener('click', () => {
  if (design.nodes.length === 0 && design.groups.length === 0) {
    showToast('The board is empty, so there is nothing to export yet.');
    return;
  }
  const json = JSON.stringify(toTemplate(design), null, 2);
  const fileName = `${currentTemplate?.id ?? 'my-board'}.json`;
  const url = URL.createObjectURL(
    new Blob([json], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported “${fileName}”`);
});

for (const { id, name } of TERRAFORM_TARGETS) {
  terraformTarget.append(new Option(name, id));
}

terraformButton.addEventListener('click', () => {
  if (design.nodes.length === 0) {
    showToast('The board is empty, so there is nothing to export yet.');
    return;
  }
  const target = terraformTarget.value as TerraformTarget;
  const { text, warnings } = toTerraform(design, target);
  const fileName = `${currentTemplate?.id ?? 'my-board'}-${target}.tf`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const skipped =
    warnings.length === 0
      ? ''
      : `. ${warnings.length} without an equivalent, left as comments`;
  showToast(`Exported “${fileName}”${skipped}`);
});

exportPngButton.addEventListener('click', async () => {
  const png = await boardToPng(design, scene.flow, scene.load);
  if (!png) {
    showToast('The board is empty, so there is nothing to export yet.');
    return;
  }
  const fileName = `${currentTemplate?.id ?? 'my-board'}.png`;
  const url = URL.createObjectURL(png);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported “${fileName}”`);
});

importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  const files = [...(importInput.files ?? [])];
  // Cleared, so choosing the same file again still counts as a change.
  importInput.value = '';
  if (files.length > 0) importFile(files);
});

/** Checks a file before anything changes; a bad file never touches the board. */
async function importFile(files: File[]): Promise<void> {
  setMenuOpen(false);
  if (files.every((file) => /\.tf$/i.test(file.name))) {
    await importTerraform(files);
    return;
  }
  const [file] = files;
  const looksLikeJson =
    /\.json$/i.test(file.name) || file.type === 'application/json';
  if (files.length > 1 || !looksLikeJson) {
    showToast(
      files.length > 1
        ? 'Drop one .json board file, or only .tf files.'
        : `“${file.name}” isn't a .json or .tf file, so it can't be imported.`,
      { error: true },
    );
    return;
  }
  const result = parseBoard(await file.text(), file.name);
  if ('error' in result) {
    showToast(`Couldn't import “${file.name}”: ${result.error}`, {
      error: true,
    });
    return;
  }
  showImportedBoard(result.board);
  showToast(`Imported “${file.name}”`, { undo: true });
}

/** Several .tf files are read as one set of resources. */
async function importTerraform(files: File[]): Promise<void> {
  const text = (await Promise.all(files.map((file) => file.text()))).join('\n');
  const result = parseTerraform(text);
  if ('error' in result) {
    showToast(`Couldn't import Terraform: ${result.error}`, { error: true });
    return;
  }
  showImportedBoard(result.board);
  const unknown = result.notes.length;
  showToast(
    unknown === 0
      ? 'Imported Terraform'
      : `Imported Terraform. ${unknown} resource${unknown === 1 ? ' has' : 's have'} no equivalent and ${unknown === 1 ? 'shows' : 'show'} as External Service`,
    { undo: true },
  );
}

// Files dragged over the board light up a drop target, so dropping feels
// safe. Counting enters and leaves keeps it lit across the board's parts.
let fileDragDepth = 0;
const carriesFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes('Files') ?? false;

function setDropZoneShown(shown: boolean): void {
  if (!shown) fileDragDepth = 0;
  dropZone.hidden = !shown;
}

boardElement.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  fileDragDepth += 1;
  setDropZoneShown(true);
});
boardElement.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  fileDragDepth -= 1;
  if (fileDragDepth <= 0) setDropZoneShown(false);
});
boardElement.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
});
boardElement.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  setDropZoneShown(false);
  importFile([...event.dataTransfer!.files]);
});

// Dropped anywhere else, the browser would open the file and leave the app.
window.addEventListener('dragover', (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  setDropZoneShown(false);
  showToast('Drop the file onto the board to import it.');
});

/**
 * The drawer explains the selected component; with nothing selected it
 * shows the template's lesson, unless the lesson was closed.
 */
function syncDrawer(): void {
  const node = nodeToExplain();
  const showLesson = !node && currentTemplate !== null && lessonOpen;
  const showing = node
    ? `${drawerRequest!.view}:${node.id}:${node.label ?? ''}:${fixState(node.id)}`
    : showLesson
      ? `lesson:${currentTemplate!.id}`
      : '';

  lessonOpenButton.hidden =
    !currentTemplate || lessonOpen || scene.selection?.type === 'node';
  if (showing === drawerShowing) return;
  drawerShowing = showing;
  drawer.hidden = showing === '';

  if (node && drawerRequest!.view === 'fix') {
    renderFix(node.id);
  } else if (node) {
    renderComponentInfo(drawerContent, findKind(node.kind), node.label);
  } else if (showLesson) {
    renderLesson(drawerContent, currentTemplate!, currentSection!);
  }
  drawerContent.scrollTop = 0;
  drawer.scrollTop = 0;
}

function fitToDesign(): void {
  const bounds = design.bounds();
  if (!bounds) {
    scene.camera = { x: 0, y: 0, scale: 1 };
    return;
  }
  scene.camera = fitCamera(bounds, visibleBoardSize(), 48);
}

templateSelect.addEventListener('change', () => {
  setNutshellOpen(false);
  openTemplate(templateSelect.value);
  templateSelect.blur();
});

/** On phones the sidebar slides in over the board. */
function setMenuOpen(open: boolean): void {
  document.body.classList.toggle('menu-open', open);
  menuToggle.ariaExpanded = String(open);
}
menuToggle.addEventListener('click', () =>
  setMenuOpen(!document.body.classList.contains('menu-open')),
);
menuBackdrop.addEventListener('click', () => setMenuOpen(false));

/** The Nutshell page covers the board; its address is #nutshell. */
function setNutshellOpen(open: boolean): void {
  nutshell.hidden = !open;
  nutshellOpenButton.ariaPressed = String(open);
  setMenuOpen(false);
  const boardHash = currentTemplate ? `#${currentTemplate.id}` : '#';
  history.replaceState(null, '', open ? '#nutshell' : boardHash);
  if (open) nutshell.scrollTop = 0;
}
nutshellOpenButton.addEventListener('click', () =>
  setNutshellOpen(nutshell.hidden),
);
nutshellCloseButton.addEventListener('click', () => setNutshellOpen(false));

blankBoardButton.addEventListener('click', () => {
  setNutshellOpen(false);
  openTemplate('');
});

/**
 * A short message at the bottom of the board. Changes offer Undo instead of
 * an "Are you sure?"; errors are red and stay longer, with a Dismiss button.
 */
function showToast(message: string, { undo = false, error = false } = {}) {
  toastMessage.textContent = message;
  toast.classList.toggle('toast-error', error);
  toast.role = error ? 'alert' : 'status';
  toastUndoes = undo;
  toastAction.hidden = !undo && !error;
  toastAction.textContent = undo ? 'Undo' : 'Dismiss';
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, error ? ERROR_TOAST_MS : TOAST_MS);
}

function hideToast(): void {
  toast.hidden = true;
}

toastAction.addEventListener('click', () => {
  if (toastUndoes) {
    undo();
    fitToDesign();
  }
  hideToast();
});

/**
 * The selected component, if its explanation was asked for. Selecting
 * alone doesn't open the drawer, so it never covers what you're arranging.
 */
function nodeToExplain() {
  const selection = scene.selection;
  if (selection?.type !== 'node' || drawerRequest?.nodeId !== selection.id) {
    return null;
  }
  return design.getNode(selection.id);
}

/**
 * What the Fix card's words depend on, so it is redrawn as soon as they
 * change: after adding a copy, or changing the number of users.
 */
function fixState(nodeId: string): string {
  if (drawerRequest?.view !== 'fix') return '';
  const node = design.getNode(nodeId);
  const load = scene.load?.nodes.get(nodeId);
  const weakest = scene.load?.weakestLink.get(nodeId);
  return [
    Math.round(load?.requests ?? 0),
    design.nodes.length,
    usersOf(node),
    scene.load?.health.get(nodeId),
    weakest,
  ].join(':');
}

function renderFix(nodeId: string): void {
  const node = design.getNode(nodeId);
  const actions = {
    addCopy: () => {
      undoHistory.record(design);
      design.copyWithConnections(nodeId);
    },
    boardName: (id: string) => {
      for (const { itemName, templates } of SECTIONS) {
        const index = templates.findIndex((template) => template.id === id);
        if (index >= 0) {
          return `${itemName} ${index + 1}, ${templates[index].title}`;
        }
      }
      return null;
    },
    showMe: (id: string) => {
      scene.selection = { type: 'node', id };
      scene.openWheel = `node:${id}`;
      drawerRequest = { nodeId: id, view: 'fix' };
    },
  };
  if (node.kind === 'client') {
    const weakestId = scene.load?.weakestLink.get(nodeId);
    renderClientFix(
      drawerContent,
      node,
      scene.load?.health.get(nodeId),
      weakestId ? design.getNode(weakestId) : undefined,
      weakestId ? scene.load?.nodes.get(weakestId) : undefined,
      actions,
    );
  } else {
    renderComponentFix(
      drawerContent,
      node,
      scene.load?.nodes.get(nodeId),
      actions,
    );
  }
}

/** Busy components, and clients whose users suffer, offer a Fix. */
function needsFix(nodeId: string): boolean {
  const node = design.getNode(nodeId);
  if (node.kind === 'client') {
    const health = scene.load?.health.get(nodeId);
    return health !== undefined && health !== 'fast';
  }
  return (scene.load?.nodes.get(nodeId)?.ratio ?? 0) >= BUSY_AT;
}

/**
 * Info is asked for one selection only. Once anything else is selected the
 * request is forgotten, so clicking that component again later just selects
 * it instead of reopening the drawer.
 */
function forgetInfoOnceDeselected(): void {
  const selection = scene.selection;
  const selectedNodeId = selection?.type === 'node' ? selection.id : null;
  if (drawerRequest?.nodeId !== selectedNodeId) drawerRequest = null;
  // A Fix card speaks about traffic, so it closes when traffic is hidden.
  if (drawerRequest?.view === 'fix' && !scene.load) drawerRequest = null;
}

/** Opens the drawer on a component's Info or Fix; the same again closes it. */
function toggleDrawer(nodeId: string, view: 'info' | 'fix'): void {
  const isOpen =
    drawerRequest?.nodeId === nodeId && drawerRequest.view === view;
  drawerRequest = isOpen ? null : { nodeId, view };
  syncDrawer();
}

function setInfoOpen(nodeId: string | null): void {
  drawerRequest = nodeId ? { nodeId, view: 'info' } : null;
  syncDrawer();
}

drawerCloseButton.addEventListener('click', () => {
  // Closing a component's explanation falls back to the lesson; the
  // component stays selected, with Info ready to reopen it.
  if (nodeToExplain()) setInfoOpen(null);
  else setLessonOpen(false);
});

nodeToolbar.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action]',
  )?.dataset.action;
  const selection = scene.selection;
  if (selection?.type !== 'node') return;
  if (action === 'users') usersPickerFor = selection.id;
  if (action === 'info') toggleDrawer(selection.id, 'info');
  if (action === 'fix') toggleDrawer(selection.id, 'fix');
  if (action === 'duplicate' && copySelectedComponent()) pasteComponent();
  if (action === 'delete') deleteSelection();
});

for (const type of ['pointerdown', 'pointerup'] as const) {
  document.addEventListener(
    type,
    (event) => {
      const onBoard = (event.target as Element).closest('.board') !== null;
      lastPress = onBoard ? toWorld(event) : null;
    },
    { capture: true },
  );
}

function pressOnScreen(): Point | null {
  return lastPress && worldToScreen(scene.camera, lastPress);
}

groupToolbar.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action]',
  )?.dataset.action;
  const index = selectedGroup();
  if (index === null) return;
  if (action === 'rename') editGroupName(index);
  if (action === 'resize') {
    scene.resizingGroup = scene.resizingGroup === index ? null : index;
  }
  if (action === 'delete') deleteSelection();
});

function selectedGroup(): number | null {
  const selection = scene.selection;
  return selection?.type === 'group' ? Number(selection.id) : null;
}

/** Resize handles belong to the selected group; selecting else hides them. */
function forgetResizeOnceDeselected(): void {
  if (scene.resizingGroup !== selectedGroup()) scene.resizingGroup = null;
}

/** Fans the group's options out above its name while it sits still. */
function syncGroupToolbar(): void {
  const index = selectedGroup();
  const group = index === null ? undefined : design.groups[index];
  const show = group !== undefined && gesture.type === 'idle' && isWheelOpen();
  groupToolbar.hidden = !show;
  if (!show) {
    placeGroupWheel(null, { x: 0, y: 0 }, null);
    return;
  }
  // Over the name, which sits at the left of the title strip.
  const name = { x: group.x + Math.min(100, group.width / 2), y: group.y - 6 };
  const target = worldToScreen(scene.camera, name);
  const { x, y } = placeGroupWheel(String(index), target, pressOnScreen());
  groupToolbar.style.left = `${x}px`;
  groupToolbar.style.top = `${y}px`;
  resizeButton.ariaPressed = String(scene.resizingGroup === index);
}

/** Fans the component's options out above it while it sits still. */
function syncNodeToolbar(): void {
  const selection = scene.selection;
  const show =
    selection?.type === 'node' &&
    gesture.type === 'idle' &&
    isWheelOpen() &&
    usersPickerFor === null;
  nodeToolbar.hidden = !show;
  if (!show) {
    placeNodeWheel(null, { x: 0, y: 0 }, null);
    return;
  }
  const node = design.getNode(selection.id);
  // Only clients have users, and only struggling things need a fix, so
  // only their wheels offer those options.
  const fixOpen =
    drawerRequest?.nodeId === node.id && drawerRequest.view === 'fix';
  const offersUsers = node.kind === 'client';
  const offersFix = needsFix(node.id) || fixOpen;
  if (usersButton.hidden === offersUsers || fixButton.hidden === offersFix) {
    usersButton.hidden = !offersUsers;
    fixButton.hidden = !offersFix;
    layoutRadialMenu(nodeToolbar);
  }
  fixButton.ariaPressed = String(fixOpen);
  // The wheel's centre sits just above the component, so the fan clears
  // it, and above the status chip when that shows.
  const top = { x: node.x, y: node.y - NODE_HEIGHT / 2 - 6 };
  const target = worldToScreen(scene.camera, top);
  if (!statusChip.hidden) {
    target.y -= statusChip.offsetHeight + WHEEL_ABOVE_STATUS;
  }
  const { x, y } = placeNodeWheel(node.id, target, pressOnScreen());
  nodeToolbar.style.left = `${x}px`;
  nodeToolbar.style.top = `${y}px`;
  nodeInfoButton.ariaPressed = String(
    drawerRequest?.nodeId === node.id && drawerRequest.view === 'info',
  );
}
// One choice per user level, each with what that size feels like.
for (const { users, story } of USER_LEVELS) {
  const option = document.createElement('button');
  option.type = 'button';
  option.role = 'radio';
  option.dataset.users = String(users);
  option.innerHTML = '<strong></strong><span></span>';
  option.children[0].textContent = describeUsers(users).replace(' users', '');
  option.children[1].textContent = story;
  usersOptions.append(option);
}

usersOptions.addEventListener('click', (event) => {
  const option = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-users]',
  );
  if (!option || !usersPickerFor) return;
  const users = Number(option.dataset.users);
  if (usersOf(design.getNode(usersPickerFor)) !== users) {
    undoHistory.record(design);
    design.setUsers(usersPickerFor, users);
  }
  // Done: back to the board, to watch what the new traffic does.
  usersPickerFor = null;
  scene.openWheel = null;
});

/** How the selected component is doing, in two lines just above it. */
function syncStatusChip(): void {
  const selection = scene.selection;
  const node = selection?.type === 'node' ? design.getNode(selection.id) : null;
  const load = scene.load;
  statusChip.hidden = !node || !load || usersPickerFor !== null;
  if (!node || !load || statusChip.hidden) return;

  const weakestId = load.weakestLink.get(node.id);
  const weakest = weakestId ? design.getNode(weakestId) : undefined;
  const status = describeStatus(
    node,
    load.nodes.get(node.id),
    load.health.get(node.id),
    weakest && (weakest.label ?? findKind(weakest.kind).label),
    scenario(),
  );
  statusChip.dataset.tone = status.tone;
  // Only touched when the words change, not on every frame.
  setText(statusLabel, status.label);
  setText(statusMeasure, status.measure ? `· ${status.measure}` : '');
  setText(statusFigures, status.figures);
  setText(statusDetail, status.detail);
  statusDetail.hidden = status.detail === '';

  const top = { x: node.x, y: node.y - NODE_HEIGHT / 2 };
  const { x, y } = worldToScreen(scene.camera, top);
  statusChip.style.left = `${x}px`;
  statusChip.style.top = `${y}px`;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Shows the picker above its client while that client stays selected. */
function syncUsersPicker(): void {
  const selection = scene.selection;
  const stillSelected =
    selection?.type === 'node' && selection.id === usersPickerFor;
  if (!stillSelected || !design.nodes.some((n) => n.id === usersPickerFor)) {
    usersPickerFor = null;
  }
  usersPicker.hidden = usersPickerFor === null;
  if (usersPickerFor === null) return;
  const node = design.getNode(usersPickerFor);
  const top = { x: node.x, y: node.y - NODE_HEIGHT / 2 };
  const { x, y } = worldToScreen(scene.camera, top);
  usersPicker.style.left = `${x}px`;
  usersPicker.style.top = `${y}px`;
  for (const option of usersOptions.children) {
    const chosen = Number((option as HTMLElement).dataset.users);
    option.ariaChecked = String(chosen === usersOf(node));
  }
}

lessonOpenButton.addEventListener('click', () => setLessonOpen(true));

function setLessonOpen(open: boolean): void {
  lessonOpen = open;
  syncDrawer();
  fitToDesign();
}

copyJsonButton.addEventListener('click', async () => {
  const json = JSON.stringify(toTemplate(design), null, 2);
  await navigator.clipboard.writeText(json);
  copyJsonButton.textContent = 'Copied!';
  setTimeout(() => (copyJsonButton.textContent = 'Copy board as JSON'), 1500);
});

/**
 * The part of the board the drawer leaves uncovered: it sits on the right,
 * or along the bottom on phones (where the menu button shows).
 */
function visibleBoardSize(): { width: number; height: number } {
  const { width, height } = boardSize();
  if (drawer.hidden) return { width, height };
  return isPhoneLayout()
    ? { width, height: height - drawer.offsetHeight - DRAWER_GAP }
    : { width: width - DRAWER_SPACE, height };
}

/** Phones get the menu button, the bottom sheet and tap-for-info. */
function isPhoneLayout(): boolean {
  return menuToggle.offsetParent !== null;
}

function boardSize() {
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    pixelRatio: window.devicePixelRatio || 1,
  };
}

function resize(): void {
  const { width, height, pixelRatio } = boardSize();
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
}
new ResizeObserver(resize).observe(canvas);

function toWorld(event: MouseEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  const screenPoint = {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
  return screenToWorld(scene.camera, screenPoint);
}

function addAtViewCenter(kindId: string): void {
  const { width, height } = visibleBoardSize();
  const center = screenToWorld(scene.camera, { x: width / 2, y: height / 2 });
  // Nudge each click-added component so they don't stack exactly.
  const jitter = () => (Math.random() - 0.5) * 80;
  undoHistory.record(design);
  const node = design.addNode(kindId, {
    x: center.x + jitter(),
    y: center.y + jitter(),
  });
  scene.selection = { type: 'node', id: node.id };
}

function canPlugInto(from: PortRef) {
  return (port: PortRef) => design.canConnect(from, port);
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  pointer = toWorld(event);

  if (groupMode) {
    scene.selection = null;
    gesture = { type: 'drawing-group', start: pointer };
    return;
  }

  // Corner handles sit on top of everything while a group is resized.
  if (scene.resizingGroup !== null) {
    const reach = (GROUP_CORNER_RADIUS * 2) / scene.camera.scale;
    const index = scene.resizingGroup;
    const fixedCorner = design.groupCornerAt(index, pointer, reach);
    if (fixedCorner) {
      gesture = { type: 'resizing-group', index, fixedCorner, moved: false };
      return;
    }
  }

  const port = portAt(design.nodes, pointer);
  // Shift-dragging a port picks up its newest cable instead of a new one.
  const newestCable = port && design.cablesAtPort(port).at(-1);
  if (event.shiftKey && port && newestCable) {
    const end = newestCable.from.nodeId === port.nodeId ? 'from' : 'to';
    unplug(newestCable.id, end);
    return;
  }
  if (port) {
    const start = design.portPoint(port);
    scene.draft = { from: port, rope: createRope(start, start), snap: null };
    gesture = { type: 'drawing-cable' };
    return;
  }

  const node = design.nodeAt(pointer);
  if (node) {
    design.bringToFront(node.id);
    scene.selection = { type: 'node', id: node.id };
    gesture = {
      type: 'moving-node',
      nodeId: node.id,
      grabOffset: { x: pointer.x - node.x, y: pointer.y - node.y },
      moved: false,
    };
    return;
  }

  const cable = design.cableAt(pointer);
  scene.selection = cable ? { type: 'cable', id: cable.id } : null;
  if (cable) {
    const grabbed = design.cableEndAt(pointer);
    if (grabbed) {
      gesture = {
        type: 'holding-cable-end',
        cableId: grabbed.cable.id,
        end: grabbed.end,
        start: { x: event.clientX, y: event.clientY },
      };
    }
    longPress = {
      timer: window.setTimeout(() => editCableLabel(cable.id), LONG_PRESS_MS),
      start: { x: event.clientX, y: event.clientY },
    };
    return;
  }

  const groupIndex = design.groupHandleAt(pointer);
  if (groupIndex >= 0) {
    scene.selection = { type: 'group', id: String(groupIndex) };
    gesture = {
      type: 'moving-group',
      index: groupIndex,
      nodeIds: design.nodesTouching(groupIndex).map((node) => node.id),
      last: pointer,
      moved: false,
    };
    // Touch screens have no double-click: holding the name renames it.
    longPress = {
      timer: window.setTimeout(() => editGroupName(groupIndex), LONG_PRESS_MS),
      start: { x: event.clientX, y: event.clientY },
    };
    return;
  }
  gesture = { type: 'panning', last: { x: event.clientX, y: event.clientY } };
});

function cancelLongPress(): void {
  if (longPress) window.clearTimeout(longPress.timer);
  longPress = null;
}

canvas.addEventListener('dblclick', (event) => {
  cancelLongPress();
  const point = toWorld(event);
  const node = design.nodeAt(point);
  if (node) return setInfoOpen(node.id);
  const cable = design.cableAt(point);
  if (cable) return editCableLabel(cable.id);
  const groupIndex = design.groupHandleAt(point);
  if (groupIndex >= 0) editGroupName(groupIndex);
});

canvas.addEventListener('pointermove', (event) => {
  pointer = toWorld(event);
  if (longPress) {
    const moved = Math.hypot(
      event.clientX - longPress.start.x,
      event.clientY - longPress.start.y,
    );
    if (moved > DRAG_SLOP) cancelLongPress();
  }
  if (gesture.type === 'holding-cable-end') {
    const { start, cableId, end } = gesture;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > DRAG_SLOP) unplug(cableId, end);
  }

  switch (gesture.type) {
    case 'moving-node':
      // Only a real drag moves it: a click, even a shaky tap, leaves it
      // in place and leaves no empty undo step behind.
      if (!gesture.moved && !draggedPastSlop(event)) break;
      if (!gesture.moved) undoHistory.record(design);
      gesture.moved = true;
      design.moveNode(gesture.nodeId, {
        x: pointer.x - gesture.grabOffset.x,
        y: pointer.y - gesture.grabOffset.y,
      });
      break;
    case 'resizing-group':
      if (!gesture.moved) undoHistory.record(design);
      gesture.moved = true;
      design.resizeGroup(gesture.index, gesture.fixedCorner, pointer);
      break;
    case 'drawing-group': {
      const area = rectBetween(gesture.start, pointer);
      scene.groupDraft = { label: '', ...area };
      break;
    }
    case 'moving-group': {
      if (!gesture.moved && !draggedPastSlop(event)) break;
      if (!gesture.moved) undoHistory.record(design);
      gesture.moved = true;
      const delta = {
        x: pointer.x - gesture.last.x,
        y: pointer.y - gesture.last.y,
      };
      design.moveGroup(gesture.index, delta, gesture.nodeIds);
      gesture.last = pointer;
      break;
    }
    case 'drawing-cable':
      scene.draft!.snap = findSnapTarget(
        design.nodes,
        pointer,
        canPlugInto(scene.draft!.from),
      );
      break;
    case 'panning':
      scene.camera.x += event.clientX - gesture.last.x;
      scene.camera.y += event.clientY - gesture.last.y;
      gesture.last = { x: event.clientX, y: event.clientY };
      break;
  }

  updateHover();
});

canvas.addEventListener('pointerup', () => {
  cancelLongPress();
  if (gesture.type === 'drawing-group') finishGroup(gesture.start, pointer);
  const draft = scene.draft;
  if (
    gesture.type === 'drawing-cable' &&
    draft?.snap &&
    design.canConnect(draft.from, draft.snap)
  ) {
    const cable = plugIn(draft, draft.snap);
    if (cable) {
      scene.selection = { type: 'cable', id: cable.id };
      adviseOnCable(cable.id);
    }
  }
  scene.draft = null;
  gesture = { type: 'idle' };
  updateHover();
});

/** Pops up advice when a new cable joins two things that don't belong. */
function adviseOnCable(cableId: string): void {
  const cable = design.getCable(cableId);
  const from = design.getNode(cable.from.nodeId);
  const to = design.getNode(cable.to.nodeId);
  const found = adviseConnection(from.kind, to.kind);
  if (!found) return;
  const nameOf = (node: typeof from) => node.label ?? findKind(node.kind).label;
  advice.showConnection(
    found,
    { from: nameOf(from), to: nameOf(to) },
    {
      flipCable: () => {
        undoHistory.record(design);
        design.flipCable(cableId);
      },
      removeCable: () => {
        undoHistory.record(design);
        design.removeCable(cableId);
        scene.selection = null;
      },
    },
  );
}

const flowPanel = createFlowPanel(
  document.querySelector<HTMLDetailsElement>('#flow-panel')!,
  (id) => {
    scene.selection = { type: 'node', id };
    scene.openWheel = `node:${id}`;
  },
);
// The check reruns only when something it depends on changes.
let checkedFor = '';

function syncFlowPanel(): void {
  const key = JSON.stringify([
    design.nodes.map(({ id, kind, users }) => [id, kind, users]),
    design.cables.map(({ from, to }) => [from.nodeId, to.nodeId]),
    worstToggle.checked,
  ]);
  if (key === checkedFor) return;
  checkedFor = key;
  flowPanel.update(checkFlow(design, scenario()));
}

/** Pulls one end of a cable out; the cable then follows the pointer. */
function unplug(cableId: string, end: 'from' | 'to'): void {
  cancelLongPress();
  const cable = design.cables.find((candidate) => candidate.id === cableId);
  if (!cable) return;
  undoHistory.record(design);
  design.removeCable(cableId);
  // The draft always grows from the end that stays plugged in.
  const reversed = end === 'from';
  if (reversed) reverseRope(cable.rope);
  scene.draft = {
    from: reversed ? cable.to : cable.from,
    rope: cable.rope,
    snap: null,
    unplugged: { label: cable.label, oneWay: cable.oneWay, reversed },
  };
  scene.selection = null;
  gesture = { type: 'drawing-cable' };
}

function plugIn(draft: CableDraft, target: PortRef) {
  const { unplugged, rope } = draft;
  if (!unplugged) {
    undoHistory.record(design);
    return design.connect(draft.from, target, { rope });
  }
  // A re-plugged cable keeps the way round it was drawn, so its traffic
  // still flows the same direction. Unplugging already recorded an undo step.
  if (unplugged.reversed) reverseRope(rope);
  const [from, to] = unplugged.reversed
    ? [target, draft.from]
    : [draft.from, target];
  const { label, oneWay } = unplugged;
  return design.connect(from, to, { rope, label, oneWay });
}

/*
 * Wheels open on a click, never after a drag. These listeners run after
 * the board's own, so they see what the press ended up selecting.
 */
let pressStart: Point | null = null;
let pressedItem: string | null = null;

canvas.addEventListener('pointerdown', (event) => {
  pressStart = { x: event.clientX, y: event.clientY };
  // Ports, corners and drawing select nothing to open a wheel for.
  pressedItem =
    gesture.type.startsWith('drawing') || gesture.type === 'resizing-group'
      ? null
      : selectionKey();
});

canvas.addEventListener('pointerup', (event) => {
  const clicked = pressStart !== null && !draggedPastSlop(event);
  scene.openWheel =
    clicked && pressedItem === selectionKey() ? pressedItem : null;
  pressStart = null;
});

function draggedPastSlop(event: PointerEvent): boolean {
  if (!pressStart) return false;
  const moved = Math.hypot(
    event.clientX - pressStart.x,
    event.clientY - pressStart.y,
  );
  return moved > DRAG_SLOP;
}

function selectionKey(): string | null {
  const selection = scene.selection;
  return selection ? `${selection.type}:${selection.id}` : null;
}

/** A wheel shows only while what it was opened for is still selected. */
function isWheelOpen(): boolean {
  return scene.openWheel !== null && scene.openWheel === selectionKey();
}

canvas.addEventListener('pointerleave', () => {
  if (gesture.type !== 'idle') return;
  scene.hoveredNodeId = null;
  scene.hoveredPort = null;
});

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const screenPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const factor = Math.exp(-event.deltaY * 0.0015);
    scene.camera = zoomAt(scene.camera, screenPoint, factor);
  },
  { passive: false },
);

canvas.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes(DRAG_FORMAT)) event.preventDefault();
});

canvas.addEventListener('drop', (event) => {
  const kindId = event.dataTransfer?.getData(DRAG_FORMAT);
  if (!kindId) return;
  event.preventDefault();
  undoHistory.record(design);
  const node = design.addNode(kindId, toWorld(event));
  scene.selection = { type: 'node', id: node.id };
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  // The board is hidden behind the Nutshell page, so leave it alone.
  if (!nutshell.hidden) {
    if (key === 'escape') setNutshellOpen(false);
    return;
  }
  // Ctrl on Windows and Linux, Cmd on macOS.
  const shortcut = event.ctrlKey || event.metaKey;

  if (shortcut && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (shortcut && key === 'c') {
    // Let the browser copy any text selected in the drawer.
    if (window.getSelection()?.toString()) return;
    if (copySelectedComponent()) event.preventDefault();
  } else if (shortcut && key === 'v') {
    if (!copied) return;
    event.preventDefault();
    pasteComponent();
  } else if (key === 'escape') {
    setMenuOpen(false);
    shortcuts.open = false;
    setGroupMode(false);
    scene.draft = null;
    scene.selection = null;
    gesture = { type: 'idle' };
  } else if (key === 'delete' || key === 'backspace') {
    deleteSelection();
  }
});

function deleteSelection(): void {
  const selection = scene.selection;
  if (!selection) return;
  undoHistory.record(design);
  if (selection.type === 'node') design.removeNode(selection.id);
  else if (selection.type === 'cable') design.removeCable(selection.id);
  else design.removeGroup(Number(selection.id));
  scene.selection = null;
}

function copySelectedComponent(): boolean {
  if (scene.selection?.type !== 'node') return false;
  const { kind, label, users, x, y } = design.getNode(scene.selection.id);
  copied = { kind, label, users, x, y };
  return true;
}

function pasteComponent(): void {
  if (!copied) return;
  // Move the stored copy too, so repeated pastes fan out in a diagonal.
  copied.x += PASTE_OFFSET;
  copied.y += PASTE_OFFSET;
  undoHistory.record(design);
  const position = { x: copied.x, y: copied.y };
  const node = design.addNode(copied.kind, position, copied.label);
  if (copied.users !== undefined) design.setUsers(node.id, copied.users);
  scene.selection = { type: 'node', id: node.id };
}

function undo(): void {
  if (!undoHistory.undo(design)) return;
  hideToast();
  scene.draft = null;
  gesture = { type: 'idle' };
  const selection = scene.selection;
  const stillThere =
    selection?.type === 'node'
      ? design.nodes.some((node) => node.id === selection.id)
      : selection?.type === 'group'
        ? Number(selection.id) < design.groups.length
        : design.cables.some((cable) => cable.id === selection?.id);
  if (!stillThere) scene.selection = null;
}

function updateHover(): void {
  const port = portAt(design.nodes, pointer);
  scene.hoveredPort = port;
  scene.hoveredNodeId = port?.nodeId ?? design.nodeAt(pointer)?.id ?? null;
  const overCableEnd =
    !scene.hoveredNodeId && design.cableEndAt(pointer) !== null;
  const groupIndex =
    gesture.type === 'moving-group'
      ? gesture.index
      : !scene.hoveredNodeId && !overCableEnd
        ? design.groupHandleAt(pointer)
        : -1;
  scene.hoveredGroup = groupIndex >= 0 ? groupIndex : null;
  const grabbable =
    scene.hoveredNodeId !== null || overCableEnd || groupIndex >= 0;
  const reach = (GROUP_CORNER_RADIUS * 2) / scene.camera.scale;
  const overCorner =
    gesture.type === 'resizing-group' ||
    (scene.resizingGroup !== null &&
      design.groupCornerAt(scene.resizingGroup, pointer, reach) !== null);
  canvas.style.cursor = overCorner
    ? 'nwse-resize'
    : cursorFor(port !== null, grabbable);
}

function cursorFor(overPort: boolean, grabbable: boolean): string {
  if (groupMode || gesture.type === 'drawing-cable' || overPort) {
    return 'crosshair';
  }
  if (gesture.type !== 'idle') return 'grabbing';
  return grabbable ? 'grab' : 'default';
}

/** The worst day pushes designs the way real rushes do. */
function scenario() {
  return worstToggle.checked ? WORST_DAY : AVERAGE_DAY;
}

flowToggle.checked = scene.flow.enabled;
flowToggle.addEventListener('change', () => {
  scene.flow.enabled = flowToggle.checked;
});

/** Shown for a selected cable, unless it is being dragged or labelled. */
function syncCableToolbar(): void {
  const selection = scene.selection;
  const busy = gesture.type !== 'idle' || !labelInput.hidden;
  const cableId =
    selection?.type === 'cable' && !busy && isWheelOpen() ? selection.id : null;
  cableToolbar.show(cableId, pressOnScreen());
}

function frame(now: number): void {
  scene.time = now / 1000;
  design.step();
  if (scene.draft) {
    const { from, snap, rope } = scene.draft;
    const end = snap ? design.portPoint(snap) : pointer;
    stepRope(rope, design.portPoint(from), end);
  }
  // Load follows the "Show traffic" toggle: both are about traffic.
  scene.load = scene.flow.enabled ? computeLoad(design, scenario()) : null;
  legendWorst.hidden = !worstToggle.checked;
  // The legend explains what traffic looks like, so it shows with it.
  legend.hidden = scene.load === null || design.nodes.length === 0;
  forgetInfoOnceDeselected();
  syncFlowPanel();
  syncDrawer();
  labelEditor.follow();
  syncCableToolbar();
  syncUsersPicker();
  // Before the wheel, which makes room above the chip.
  syncStatusChip();
  syncNodeToolbar();
  forgetResizeOnceDeselected();
  syncGroupToolbar();
  // Nothing to clear on a blank board that is already showing.
  blankBoardButton.hidden = !currentTemplate && design.nodes.length === 0;
  backToNutshellButton.hidden = !nutshellReturnRow;
  render(ctx, scene, boardSize());
  requestAnimationFrame(frame);
}

resize();
// Phones have little room: the legend starts folded there.
if (isPhoneLayout()) {
  legend.open = false;
}

const startHash = decodeURIComponent(location.hash.slice(1));
openTemplate(startHash);
if (startHash === 'nutshell') setNutshellOpen(true);
requestAnimationFrame(frame);
