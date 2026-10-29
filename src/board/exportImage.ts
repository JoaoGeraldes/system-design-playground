import type { Design } from '../model/design.ts';
import { frameCamera } from './camera.ts';
import { render, type Scene } from './render.ts';

/** How many pixels per board unit, so the image stays sharp when zoomed. */
const PIXEL_RATIO = 2;

/**
 * The whole board as a PNG, drawn the way it looks on screen but without
 * selections, wheels or half-drawn cables. Null when the board is empty.
 */
export function boardToPng(
  design: Design,
  flow: Scene['flow'],
  load: Scene['load'],
): Promise<Blob | null> {
  const bounds = design.bounds();
  if (!bounds) return Promise.resolve(null);
  const { camera, width, height } = frameCamera(bounds);

  const canvas = document.createElement('canvas');
  canvas.width = width * PIXEL_RATIO;
  canvas.height = height * PIXEL_RATIO;
  const scene: Scene = {
    design,
    camera,
    selection: null,
    hoveredNodeId: null,
    hoveredGroup: null,
    hoveredPort: null,
    draft: null,
    groupDraft: null,
    openWheel: null,
    load,
    resizingGroup: null,
    flow,
    time: 0,
  };
  render(canvas.getContext('2d')!, scene, {
    width,
    height,
    pixelRatio: PIXEL_RATIO,
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
