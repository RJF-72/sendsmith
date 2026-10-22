// SendSmith account API client. All account traffic goes through this
// module (the app's API layer) so the UI framework never talks to the
// server directly — a future frontend swap only rewrites this file's
// consumers, not the protocol. Sessions are httpOnly cookies set by
// the server; the browser sends them automatically on same-origin
// requests, including the WebSocket upgrade.

async function request(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // non-JSON response
  }
  if (!res.ok) {
    const err = new Error(
      (data && data.error) || `Request failed (${res.status})`
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

export default {
  signup(email, password, botToken) {
    return request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, botToken })
    });
  },
  login(email, password, botToken) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, botToken })
    });
  },
  logout() {
    return request('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return request('/api/auth/me');
  },
  checkout() {
    return request('/api/billing/checkout', { method: 'POST' });
  },
  portal() {
    return request('/api/billing/portal');
  }
};
