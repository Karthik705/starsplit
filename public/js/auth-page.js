// Log in / sign up page.
import { api } from './api.js';
import { state } from './state.js';
import { $app, toast } from './ui.js';
import { esc } from './util.js';
import { setNav } from './nav.js';
import { heroSky } from './landing.js';

/** Where to go after logging in: back to the invite link that sent us here, or home. */
function goNext() {
  const next = sessionStorage.getItem('starsplit:next');
  sessionStorage.removeItem('starsplit:next');
  location.hash = next && next.startsWith('#/g/') ? next : '#/';
}

const googleSvg = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/** Shell shared by every account page: constellation on one side, a card on the other. */
function authShell(inner) {
  $app.innerHTML = `<div class="auth"><div class="auth-art" aria-hidden="true">${heroSky()}</div>${inner}</div>`;
}

export function renderAuth(mode, query = '') {
  const signup = mode === 'signup';
  document.title = `${signup ? 'Sign up' : 'Log in'} · Starsplit`;
  state.g = null;
  setNav();
  const invited = (sessionStorage.getItem('starsplit:next') || '').startsWith('#/g/');
  const urlError = new URLSearchParams(query).get('error') || '';
  const next = sessionStorage.getItem('starsplit:next') || '';
  authShell(`
      <form class="card auth-card" id="auth-form" novalidate>
        <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
        <p class="muted">${invited ? 'Log in or sign up to open the group you were invited to.' : signup ? 'Your groups, saved to your account and synced everywhere.' : 'Log in to see your constellations.'}</p>
        ${state.google ? `<a class="btn block big google" href="/api/auth/google${next.startsWith('#/g/') ? `?next=${encodeURIComponent(next)}` : ''}">${googleSvg} Continue with Google</a>
        <div class="or"><span>or with email</span></div>` : ''}
        <div class="list">
          ${signup ? '<label class="row-item"><span class="lbl">Name</span><input name="name" autocomplete="name" placeholder="Karthik" maxlength="40" required></label>' : ''}
          <label class="row-item"><span class="lbl">Email</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
          <label class="row-item"><span class="lbl">Password</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? '8+ characters' : 'Password'}" minlength="${signup ? 8 : 1}" required>
            <button type="button" class="linkish small" id="show-pw" aria-label="Show password">Show</button></label>
        </div>
        ${signup ? '' : '<p class="forgot"><a href="#/forgot" class="small">Forgot password?</a></p>'}
        <p class="form-error" id="auth-error" role="alert">${esc(urlError)}</p>
        <button class="btn block big">${signup ? 'Create account' : 'Log in'}</button>
        <p class="auth-switch muted small">${signup ? 'Already have an account? <a href="#/login">Log in</a>' : 'New to Starsplit? <a href="#/signup">Create an account</a>'}</p>
      </form>`);

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

export function renderForgot() {
  document.title = 'Reset password · Starsplit';
  setNav();
  authShell(`
    <form class="card auth-card" id="forgot-form">
      <h1>Forgot your password?</h1>
      <p class="muted">Enter your email and we’ll send you a link to set a new one.</p>
      <div class="list"><label class="row-item"><span class="lbl">Email</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label></div>
      <p class="form-error" id="auth-error" role="alert"></p>
      <button class="btn block big">Send reset link</button>
      <p class="auth-switch muted small"><a href="#/login">Back to log in</a></p>
    </form>`);
  const form = document.getElementById('forgot-form');
  form.email.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.btn');
    btn.disabled = true;
    try {
      await api('/auth/forgot', 'POST', { email: form.email.value });
      form.innerHTML = `<h1>Check your inbox ✉️</h1>
        <p class="muted">If an account exists for <b>${esc(form.email.value)}</b>, a reset link is on its way. It works for 30 minutes.</p>
        <p class="auth-switch muted small"><a href="#/login">Back to log in</a></p>`;
    } catch (err) {
      document.getElementById('auth-error').textContent = err.message;
      btn.disabled = false;
    }
  };
}

export function renderReset(token) {
  document.title = 'Set a new password · Starsplit';
  setNav();
  authShell(`
    <form class="card auth-card" id="reset-form">
      <h1>Set a new password</h1>
      <p class="muted">Choose something at least 8 characters long. You’ll be logged in right after.</p>
      <div class="list"><label class="row-item"><span class="lbl">Password</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="8+ characters" required></label></div>
      <p class="form-error" id="auth-error" role="alert"></p>
      <button class="btn block big">Save password</button>
    </form>`);
  const form = document.getElementById('reset-form');
  form.password.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('.btn');
    btn.disabled = true;
    try {
      const { user } = await api('/auth/reset', 'POST', { token, password: form.password.value });
      state.user = user;
      toast('Password updated ✦');
      location.hash = '#/';
    } catch (err) {
      document.getElementById('auth-error').textContent = err.message;
      btn.disabled = false;
    }
  };
}
