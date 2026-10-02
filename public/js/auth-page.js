// Log in / sign up page.
import { api } from './api.js';
import { state } from './state.js';
import { $app, toast } from './ui.js';
import { setNav } from './nav.js';
import { heroSky } from './landing.js';

/** Where to go after logging in: back to the invite link that sent us here, or home. */
function goNext() {
  const next = sessionStorage.getItem('starsplit:next');
  sessionStorage.removeItem('starsplit:next');
  location.hash = next && next.startsWith('#/g/') ? next : '#/';
}

export function renderAuth(mode) {
  const signup = mode === 'signup';
  document.title = `${signup ? 'Sign up' : 'Log in'} · Starsplit`;
  state.g = null;
  setNav();
  const invited = (sessionStorage.getItem('starsplit:next') || '').startsWith('#/g/');
  $app.innerHTML = `
    <div class="auth">
      <div class="auth-art" aria-hidden="true">${heroSky()}</div>
      <form class="card auth-card" id="auth-form" novalidate>
        <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
        <p class="muted">${invited ? 'Log in or sign up to open the group you were invited to.' : signup ? 'Your groups, saved to your account and synced everywhere.' : 'Log in to see your constellations.'}</p>
        <div class="list">
          ${signup ? '<label class="row-item"><span class="lbl">Name</span><input name="name" autocomplete="name" placeholder="Karthik" maxlength="40" required></label>' : ''}
          <label class="row-item"><span class="lbl">Email</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
          <label class="row-item"><span class="lbl">Password</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? '8+ characters' : 'Password'}" minlength="${signup ? 8 : 1}" required>
            <button type="button" class="linkish small" id="show-pw" aria-label="Show password">Show</button></label>
        </div>
        <p class="form-error" id="auth-error" role="alert"></p>
        <button class="btn block big">${signup ? 'Create account' : 'Log in'}</button>
        <p class="auth-switch muted small">${signup ? 'Already have an account? <a href="#/login">Log in</a>' : 'New to Starsplit? <a href="#/signup">Create an account</a>'}</p>
      </form>
    </div>`;

  const form = document.getElementById('auth-form');
  const err = document.getElementById('auth-error');
  form.querySelector('input').focus();
  document.getElementById('show-pw').onclick = (e) => {
    const pw = form.password;
    pw.type = pw.type === 'password' ? 'text' : 'password';
    e.target.textContent = pw.type === 'password' ? 'Show' : 'Hide';
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!form.reportValidity()) return;
    const btn = form.querySelector('.btn');
    btn.disabled = true;
    try {
      const body = { email: form.email.value, password: form.password.value };
      if (signup) body.name = form.name.value;
      const { user } = await api(`/auth/${signup ? 'signup' : 'login'}`, 'POST', body);
      state.user = user;
      toast(signup ? `Welcome to Starsplit, ${user.name} ✦` : `Welcome back, ${user.name}`);
      goNext();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
}
