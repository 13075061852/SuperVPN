import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachMenuDismissal } from '../src/menu-dismissal.js';
function fixture() {
  function emitter() { const events = new Map(); return { events, addEventListener(name, handler) { events.set(name, handler); }, removeEventListener(name, handler) { if (events.get(name) === handler) events.delete(name); }, fire(name, event = {}) { events.get(name)?.(event); } }; }
  const document = emitter(), window = emitter(), root = emitter();
  const menus = [0, 1].map(() => {
    const menu = { open: false, matches: selector => selector === 'details.profile-menu', contains: node => node === menu || node?.parent === menu };
    menu.summary = { parent: menu, focus() { document.activeElement = this; } };
    menu.item = { parent: menu, closest: () => menu };
    menu.querySelector = () => menu.summary;
    return menu;
  });
  root.querySelectorAll = () => menus.filter(menu => menu.open);
  const dispose = attachMenuDismissal(root, document, window);
  return { root, document, window, menus, dispose };
}
test('clicking outside closes source menus while clicking an item inside leaves its action intact', () => {
  const { document, menus, dispose } = fixture(); menus[0].open = true;
  document.fire('pointerdown', { target: menus[0].item }); assert.equal(menus[0].open, true);
  document.fire('pointerdown', { target: {} }); assert.equal(menus[0].open, false); dispose();
});
test('opening one source menu closes every other menu', () => {
  const { root, menus, dispose } = fixture(); menus[0].open = true; menus[1].open = true;
  root.fire('toggle', { target: menus[1] }); assert.equal(menus[0].open, false); assert.equal(menus[1].open, true); dispose();
});
test('focus moving outside or window blur closes menus, but focus within does not', () => {
  const { document, window, root, menus, dispose } = fixture(); menus[0].open = true;
  document.fire('focusin', { target: menus[0].item }); assert.equal(menus[0].open, true);
  root.fire('focusout', { target: menus[0].item, relatedTarget: menus[0].summary }); assert.equal(menus[0].open, true);
  root.fire('focusout', { target: menus[0].item, relatedTarget: null }); assert.equal(menus[0].open, false);
  menus[0].open = true; document.fire('focusin', { target: {} }); assert.equal(menus[0].open, false);
  menus[0].open = true; window.fire('blur'); assert.equal(menus[0].open, false); dispose();
});
test('Escape closes and returns keyboard focus to the originating trigger', () => {
  const { document, menus, dispose } = fixture(); menus[0].open = true; document.activeElement = menus[0].item;
  let prevented = false; document.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(menus[0].open, false); assert.equal(document.activeElement, menus[0].summary); assert.equal(prevented, true); dispose();
});
test('unmount removes every listener and closes any remaining menus', () => {
  const { document, window, root, menus, dispose } = fixture(); menus[0].open = true; dispose();
  assert.equal(menus[0].open, false); assert.equal(document.events.size, 0); assert.equal(window.events.size, 0); assert.equal(root.events.size, 0);
});
