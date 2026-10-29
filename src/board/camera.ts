import { clamp, type Point } from '../model/geometry.ts';

/** `x` and `y` are where the world origin appears on screen. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  };
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: point.x * camera.scale + camera.x,
    y: point.y * camera.scale + camera.y,
  };
}

export function zoomAt(
  camera: Camera,
  screenPoint: Point,
  factor: number,
): Camera {
  const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
  const anchor = screenToWorld(camera, screenPoint);
  return {
    scale,
    x: screenPoint.x - anchor.x * scale,
    y: screenPoint.y - anchor.y * scale,
  };
}

/** A camera that shows `bounds` centred in a view of the given size. */
export function fitCamera(
  bounds: { left: number; top: number; right: number; bottom: number },
  view: { width: number; height: number },
  padding = 64,
): Camera {
  const fitWidth = (view.width - padding * 2) / (bounds.right - bounds.left);
  const fitHeight = (view.height - padding * 2) / (bounds.bottom - bounds.top);
  // Never zoom in past 100%, so small designs keep their natural size.
  const scale = clamp(Math.min(fitWidth, fitHeight, 1), MIN_SCALE, MAX_SCALE);
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return {
    scale,
    x: view.width / 2 - centerX * scale,
    y: view.height / 2 - centerY * scale,
  };
}

/** A camera and image size that show all of `bounds` at 100%, with a margin. */
export function frameCamera(
  bounds: { left: number; top: number; right: number; bottom: number },
  margin = 48,
): { camera: Camera; width: number; height: number } {
  return {
    camera: { scale: 1, x: margin - bounds.left, y: margin - bounds.top },
    width: Math.ceil(bounds.right - bounds.left + margin * 2),
    height: Math.ceil(bounds.bottom - bounds.top + margin * 2),
  };
}
