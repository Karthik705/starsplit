// Translucent navigation bar with a collapsing large title and the theme toggle.
import { esc, store, initial } from './util.js';
import { $app, transition, openSheet, closeSheet, toast } from './ui.js';
import { state } from './state.js';
import { api } from './api.js';

const $nav = document.getElementById('nav');

const sunSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const moonSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const backSvg = '<svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>';
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

export function setNav({ back = false, title = '' } = {}) {
  $nav.innerHTML = `<div class="nav-inner">
    ${back ? `<a class="nav-btn" href="#">${backSvg}Groups</a>` : '<a class="brand" href="#"><span class="brand-mark">✦</span>Starsplit</a>'}
    <div class="nav-title" id="nav-title">${esc(title)}</div>
    <div class="nav-right">
      <button class="nav-btn icon" id="theme" aria-label="Switch between light and dark mode">${isDark() ? sunSvg : moonSvg}</button>
      ${state.user ? `<button class="nav-avatar" id="account" aria-label="Account">${initial(state.user.name)}</button>` : ''}
    </div>
  </div>`;
  document.getElementById('theme').onclick = () => {
    const next = isDark() ? 'light' : 'dark';
    transition(() => {
      document.documentElement.dataset.theme = next;
      store('starsplit:theme', next);
      document.getElementById('theme').innerHTML = next === 'dark' ? sunSvg : moonSvg;
    });
  };
  document.getElementById('account')?.addEventListener('click', openAccount);
  watchLargeTitle();
}

function openAccount() {
  const u = state.user;
  openSheet(`
    <div class="alert account">
      <span class="nav-avatar big">${initial(u.name)}</span>
      <h2>${esc(u.name)}</h2>
      <p>${esc(u.email)}</p>
      <div class="alert-actions">
        <button type="button" class="btn gray" id="acc-close">Close</button>
        <button type="button" class="btn danger" id="logout">Log out</button>
      </div>
    </div>`, { small: true });
  document.getElementById('acc-close').onclick = closeSheet;
  document.getElementById('logout').onclick = async () => {
    await api('/auth/logout', 'POST').catch(() => {});
    state.user = null;
    closeSheet();
    toast('Logged out');
    if (location.hash === '#/') dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '#/';
  };
}
addEventListener('scroll', () => $nav.classList.toggle('scrolled', scrollY > 6), { passive: true });

let titleObserver;
/** Show the small centred title once the page's large title scrolls under the bar. */
export function watchLargeTitle() {
  titleObserver?.disconnect();
  const h = $app.querySelector('h1.large');
  const t = document.getElementById('nav-title');
  if (!h || !t || !('IntersectionObserver' in window)) return;
  titleObserver = new IntersectionObserver(([e]) => t.classList.toggle('show', !e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
  titleObserver.observe(h);
}
