// Starsplit front end: vanilla JS modules, hash routing, no build step.
//   #/                -> landing page (logged out) or your groups (logged in)
//   #/login, #/signup -> account forms
//   #/g/CODE[/tab]    -> a group, optionally on the insights or wrapped tab (login required)
import { api } from './api.js';
import { state } from './state.js';
import { toastError, transition } from './ui.js';
import { disconnectLive } from './actions.js';
import { renderLanding } from './landing.js';
import { renderAuth } from './auth-page.js';
import { renderHome } from './home.js';
import { openGroup } from './group.js';

async function route() {
  disconnectLive();
  scrollTo(0, 0);
  const hash = location.hash;
  const auth = hash.match(/^#\/(login|signup)$/);
  const group = hash.match(/^#\/g\/([A-Za-z0-9]+)(?:\/(insights|wrapped))?/);

  if (auth) {
    if (state.user) return (location.hash = '#/');
    return transition(() => renderAuth(auth[1]));
  }
  if (!state.user) {
    if (group) {
      // an invite link: log in first, then come straight back to the group
      sessionStorage.setItem('starsplit:next', hash);
      return (location.hash = '#/signup');
    }
    return transition(renderLanding);
  }
  if (!group) return renderHome();
  try {
    await openGroup(group[1], group[2] || 'sky');
  } catch (err) {
    toastError(err.message);
    location.hash = '#/';
  }
}

addEventListener('hashchange', route);
try { state.user = (await api('/auth/me')).user; } catch { /* offline: show the landing page */ }
route();
