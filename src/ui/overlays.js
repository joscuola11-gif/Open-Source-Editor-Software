// Toast, dialoghi modali e menu contestuali.

import { h, clear } from './dom.js';
import { icon } from './icons.js';

let toastHost = null;
export function toast(message, { type = 'info', ms } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${type}` }, h('span', { class: 'toast-msg' }, message));
  toastHost.append(el);
  const life = ms ?? (type === 'error' ? 7000 : type === 'warn' ? 5500 : 3200);
  const kill = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', kill);
  setTimeout(kill, life);
  while (toastHost.children.length > 5) toastHost.firstChild.remove();
  return el;
}

/** Dialogo modale. `actions`: [{label, primary, danger, onClick(ctl) → false per non chiudere}] */
export function openDialog({ title, content, actions = [], wide = false, onClose, id }) {
  const dlg = h('dialog', { class: `dialog${wide ? ' wide' : ''}`, 'aria-labelledby': 'dlg-title', id });
  const close = (result) => {
    if (dlg.open) dlg.close();
    dlg.remove();
    onClose?.(result);
  };
  const ctl = { close, el: dlg, body: null, setActions: null };
  const body = h('div', { class: 'dialog-body' }, content);
  ctl.body = body;
  const foot = h('div', { class: 'dialog-foot' });
  const renderActions = (list) => {
    clear(foot);
    for (const a of list) {
      foot.append(
        h(
          'button',
          {
            class: `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
            type: 'button',
            disabled: a.disabled,
            'data-act': a.id ?? a.label,
            onClick: async () => {
              const r = await a.onClick?.(ctl);
              if (r !== false) close(a.label);
            },
          },
          a.label,
        ),
      );
    }
  };
  ctl.setActions = renderActions;
  renderActions(actions);
  dlg.append(
    h('header', { class: 'dialog-head' }, h('h2', { id: 'dlg-title' }, title), h('button', { class: 'icon-btn', 'aria-label': 'Chiudi', type: 'button', onClick: () => close('x') }, icon('x'))),
    body,
    actions.length ? foot : null,
  );
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close('esc');
  });
  document.body.append(dlg);
  dlg.showModal();
  return ctl;
}

export function confirmDialog(message, { confirmLabel = 'Conferma', danger = false, title = 'Conferma' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      content: h('p', { class: 'dialog-text' }, message),
      actions: [
        { label: 'Annulla', onClick: () => { answered = true; resolve(false); } },
        { label: confirmLabel, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => !answered && resolve(false),
    });
  });
}

export function promptDialog(title, value = '', { label = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'text-input', type: 'text', value, 'aria-label': label || title, maxlength: 120 });
    let answered = false;
    const ctl = openDialog({
      title,
      content: h('div', {}, label ? h('label', { class: 'field-label' }, label) : null, input),
      actions: [
        { label: 'Annulla', onClick: () => { answered = true; resolve(null); } },
        { label: 'OK', primary: true, onClick: () => { answered = true; resolve(input.value.trim() || null); } },
      ],
      onClose: () => !answered && resolve(null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        answered = true;
        resolve(input.value.trim() || null);
        ctl.close('ok');
      }
    });
    input.focus();
    input.select();
  });
}

let openMenu = null;
export function closeContextMenu() {
  openMenu?.remove();
  openMenu = null;
}

/** items: [{label, icon, onClick, disabled, danger, shortcut} | 'sep'] */
export function contextMenu(x, y, items) {
  closeContextMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') {
      menu.append(h('div', { class: 'ctx-sep', role: 'separator' }));
      continue;
    }
    if (it.heading) {
      menu.append(h('div', { class: 'ctx-heading', role: 'presentation' }, it.heading));
      continue;
    }
    menu.append(
      h(
        'button',
        {
          class: `ctx-item${it.danger ? ' danger' : ''}`,
          role: 'menuitem',
          type: 'button',
          disabled: it.disabled,
          onClick: () => {
            closeContextMenu();
            it.onClick?.();
          },
        },
        it.icon ? icon(it.icon, 16) : h('span', { class: 'ico-spacer' }),
        h('span', { class: 'ctx-label' }, it.label),
        it.shortcut ? h('kbd', {}, it.shortcut) : null,
      ),
    );
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  openMenu = menu;
  const off = (e) => {
    if (menu.contains(e.target)) return;
    closeContextMenu();
    removeEventListener('pointerdown', off, true);
  };
  setTimeout(() => addEventListener('pointerdown', off, true));
  addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      closeContextMenu();
      removeEventListener('keydown', onKey, true);
    }
  }, true);
  menu.querySelector('button:not([disabled])')?.focus();
  return menu;
}
