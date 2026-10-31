// Native <details> supplies keyboard activation; these listeners add popover
// dismissal without swallowing clicks on menu items or neighboring cards.
export function attachMenuDismissal(root, document, window) {
  const opened = () => [...root.querySelectorAll('details.profile-menu[open]')];
  const closeOutside = target => { for (const menu of opened()) if (!target || !menu.contains(target)) menu.open = false; };
  const pointer = event => closeOutside(event.target);
  const focus = event => closeOutside(event.target);
  const blur = () => closeOutside(null);
  const focusout = event => { if (event.target.closest?.('details.profile-menu')) closeOutside(event.relatedTarget); };
  const toggle = event => {
    const menu = event.target;
    if (menu.matches?.('details.profile-menu') && menu.open) closeOutside(menu);
  };
  const key = event => {
    if (event.key !== 'Escape') return;
    const menus = opened();
    if (!menus.length) return;
    const focused = menus.find(menu => menu.contains(document.activeElement));
    closeOutside(null);
    event.preventDefault();
    focused?.querySelector('summary')?.focus();
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('focusin', focus, true);
  document.addEventListener('keydown', key);
  root.addEventListener('focusout', focusout);
  root.addEventListener('toggle', toggle, true);
  window.addEventListener('blur', blur);
  return () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('focusin', focus, true);
    document.removeEventListener('keydown', key);
    root.removeEventListener('focusout', focusout);
    root.removeEventListener('toggle', toggle, true);
    window.removeEventListener('blur', blur);
    closeOutside(null);
  };
}
