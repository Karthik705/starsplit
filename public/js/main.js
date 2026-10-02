// Starsplit front end: vanilla JS modules, hash routing, no build step.
//   #/               -> home
//   #/g/CODE[/tab]   -> a group, optionally on the insights or wrapped tab
import { toastError, transition } from './ui.js';
import { disconnectLive } from './actions.js';
import { renderHome } from './home.js';
import { openGroup } from './group.js';

async function route() {
  disconnectLive();
  scrollTo(0, 0);
  const match = location.hash.match(/^#\/g\/([A-Za-z0-9]+)(?:\/(insights|wrapped))?/);
  if (!match) return transition(renderHome);
  try {
    await openGroup(match[1], match[2] || 'sky');
  } catch (err) {
    toastError(err.message);
    location.hash = '';
  }
}

addEventListener('hashchange', route);
route();
