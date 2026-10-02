export async function api(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('You seem to be offline');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // session expired: log in again and come back here afterwards
    sessionStorage.setItem('starsplit:next', location.hash);
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
