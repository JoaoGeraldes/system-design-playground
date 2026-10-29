import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fitCamera,
  frameCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../src/board/camera.ts';

test('screen points convert to world points with pan and zoom', () => {
  const camera = { x: 100, y: 50, scale: 2 };
  assert.deepEqual(screenToWorld(camera, { x: 300, y: 250 }), {
    x: 100,
    y: 100,
  });
});

test('zooming keeps the point under the cursor in place', () => {
  const camera = { x: 30, y: -20, scale: 1 };
  const cursor = { x: 400, y: 300 };
  const before = screenToWorld(camera, cursor);
  const after = screenToWorld(zoomAt(camera, cursor, 1.5), cursor);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test('zoom stays within a sensible range', () => {
  const camera = { x: 0, y: 0, scale: 1 };
  assert.equal(zoomAt(camera, { x: 0, y: 0 }, 100).scale, 2.5);
  assert.equal(zoomAt(camera, { x: 0, y: 0 }, 0.001).scale, 0.3);
});

test('fitting centres the content in the view', () => {
  const bounds = { left: 0, top: 0, right: 200, bottom: 100 };
  const camera = fitCamera(bounds, { width: 800, height: 600 });
  const center = screenToWorld(camera, { x: 400, y: 300 });
  assert.deepEqual(center, { x: 100, y: 50 });
});

test('fitting never zooms in past 100%', () => {
  const bounds = { left: 0, top: 0, right: 100, bottom: 50 };
  assert.equal(fitCamera(bounds, { width: 1600, height: 900 }).scale, 1);
});

test('fitting zooms out so wide content fits the view', () => {
  const bounds = { left: 0, top: 0, right: 2000, bottom: 100 };
  const camera = fitCamera(bounds, { width: 1000, height: 800 }, 0);
  assert.equal(camera.scale, 0.5);
});

test('world points convert back to the same screen points', () => {
  const camera = { x: 100, y: 50, scale: 2 };
  const screen = { x: 300, y: 250 };
  assert.deepEqual(
    worldToScreen(camera, screenToWorld(camera, screen)),
    screen,
  );
});

test('framing makes an image just big enough for the content and a margin', () => {
  const { camera, width, height } = frameCamera(
    { left: -100, top: 20, right: 300, bottom: 120 },
    10,
  );
  assert.deepEqual([width, height], [420, 120]);
  assert.deepEqual(worldToScreen(camera, { x: -100, y: 20 }), { x: 10, y: 10 });
});
