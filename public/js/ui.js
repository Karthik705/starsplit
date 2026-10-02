// Shared UI primitives: toast, tooltip, counters, segmented controls, sheets.
import { reduceMotion, money, esc } from './util.js';

export const $app = document.getElementById('app');
export const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');
const $tip = document.getElementById('tip');

/** Wrap a DOM update in a cross-fade / slide using the View Transitions API when available. */
export function transition(fn) {
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(fn);
  else fn();
}

// ---------- toast (optionally with an action, e.g. Undo) ----------
let toastTimer;
export function toast(msg, { error = false, action } = {}) {
  $toast.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  $toast.className = 'show' + (error ? ' error' : '') + (action ? ' has-action' : '');
  if (action) $toast.querySelector('button').onclick = () => { hideToast(); action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
export const toastError = (msg) => toast(msg, { error: true });
const hideToast = () => ($toast.className = '');

// ---------- tooltip: any element with data-tip shows its text ----------
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return void ($tip.className = '');
  showTip(t.dataset.tip, e.clientX, e.clientY);
});
export function showTip(text, x, y) {
  $tip.textContent = text;
  $tip.className = 'show';
  const w = $tip.offsetWidth;
  $tip.style.left = Math.min(x + 14, innerWidth - w - 8) + 'px';
  $tip.style.top = y + 16 + 'px';
}
export const hideTip = () => ($tip.className = '');

/** Animate a number from `from` to `to` (in cents) with an ease-out curve. */
export function countTo(el, from, to) {
  if (!el) return;
  if (reduceMotion || from === to) { el.textContent = money(to); return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = money(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 4))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- segmented controls with a sliding thumb ----------
function placeThumb(seg) {
  const on = seg.querySelector('button.on');
  const thumb = seg.querySelector('.thumb');
  if (!on || !thumb) return;
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}
export function initSegs(root = document) {
  root.querySelectorAll('.seg').forEach((seg) => {
    if (!seg.querySelector('.thumb')) seg.insertAdjacentHTML('afterbegin', '<span class="thumb"></span>');
    placeThumb(seg);
    if (!seg.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.add('ready')));
  });
}
export function selectSeg(seg, btn) {
  seg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b === btn);
    if (b.hasAttribute('aria-selected')) b.setAttribute('aria-selected', b === btn);
  });
  placeThumb(seg);
}
addEventListener('resize', () => initSegs());

// ---------- celebration ----------
export function burst() {
  if (reduceMotion) return;
  for (let i = 0; i < 44; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = '✦';
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 280;
    s.style.cssText = `--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist - 80}px;color:${['#ffcc00', '#ff2d55', '#34c759', '#5ac8fa', '#af52de', '#ff9500'][i % 6]};font-size:${10 + Math.random() * 20}px`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1700);
  }
}

// ---------- sheets (one <dialog>, many contents) ----------
let onSheetClose = null;

export function openSheet(html, { small = false, onClose = null } = {}) {
  onSheetClose?.();
  onSheetClose = onClose;
  $modal.innerHTML = html;
  $modal.classList.remove('closing');
  $modal.classList.toggle('small', small);
  if (!$modal.open) $modal.showModal();
  initSegs($modal);
}

export function closeSheet() {
  if (!$modal.open || $modal.classList.contains('closing')) return;
  const finish = () => {
    $modal.close();
    $modal.classList.remove('closing');
    const cb = onSheetClose;
    onSheetClose = null;
    cb?.();
  };
  if (reduceMotion) return finish();
  $modal.classList.add('closing');
  setTimeout(finish, 290);
}
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeSheet(); });
$modal.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });

/** iOS-style action sheet. Resolves true when the person confirms. */
export function confirmSheet({ title, message = '', confirm = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet(`
      <div class="alert">
        <h2>${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="alert-actions">
          <button type="button" class="btn gray" data-a="no">Cancel</button>
          <button type="button" class="btn ${danger ? 'danger' : ''}" data-a="yes">${esc(confirm)}</button>
        </div>
      </div>`, { small: true, onClose: () => resolve(answer) });
    $modal.querySelector('[data-a="yes"]').focus();
    $modal.querySelector('.alert-actions').onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      answer = b.dataset.a === 'yes';
      closeSheet();
    };
  });
}
