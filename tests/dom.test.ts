import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldOnPressOutside } from '../src/ui/dom.ts';

function pressablePanel(open: boolean) {
  const root = new EventTarget();
  let pressInside = false;
  const panel = { open, contains: () => pressInside };
  foldOnPressOutside(panel, root);
  const press = (inside: boolean) => {
    pressInside = inside;
    root.dispatchEvent(new Event('pointerdown'));
  };
  return { panel, press };
}

test('an open panel folds when pressed outside', () => {
  const { panel, press } = pressablePanel(true);
  press(false);
  assert.equal(panel.open, false);
});

test('an open panel stays open when pressed inside', () => {
  const { panel, press } = pressablePanel(true);
  press(true);
  assert.equal(panel.open, true);
});

test('a folded panel stays folded when pressed anywhere', () => {
  const { panel, press } = pressablePanel(false);
  press(false);
  press(true);
  assert.equal(panel.open, false);
});
