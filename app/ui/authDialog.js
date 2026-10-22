import html from 'choo/html';

// SendSmith account dialog: email + password login/signup against the
// first-party accounts API (app/auth.js). Turnstile widget renders when
// the operator configured a site key (state.authConfig.turnstileSiteKey);
// the server only enforces it when the matching secret is set.
export default function authDialog(state, emit, close) {
  const mode = state.authMode || 'signup';
  const isSignup = mode === 'signup';
  const turnstileSiteKey =
    state.authConfig && state.authConfig.turnstileSiteKey;

  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    emit('auth-submit', {
      mode,
      email: form.get('email'),
      password: form.get('password'),
      botToken:
        (event.target.querySelector('[name="cf-turnstile-response"]') || {})
          .value || undefined
    });
  }

  function switchMode(event) {
    event.preventDefault();
    emit('auth-mode', isSignup ? 'login' : 'signup');
  }

  return html`
    <send-auth-dialog
      class="flex flex-col items-center justify-center max-w-sm m-auto p-4"
    >
      <h2 class="text-2xl font-semibold my-4 dark:text-grey-10">
        ${isSignup ? 'Create your SendSmith account' : 'Log in to SendSmith'}
      </h2>
      <p class="text-center text-grey-70 dark:text-grey-30 mb-4">
        Accounts get bigger uploads, longer expiry, and more downloads.
        Sending anonymously still works — no account needed.
      </p>
      ${state.authError
        ? html`
            <p class="text-red-60 dark:text-red-40 mb-4" role="alert">
              ${state.authError}
            </p>
          `
        : ''}
      <form onsubmit=${submit} class="w-full flex flex-col">
        <label class="mb-3">
          <span class="block text-sm font-semibold mb-1 dark:text-grey-20"
            >Email</span
          >
          <input
            type="email"
            name="email"
            required
            autocomplete="email"
            class="w-full border border-grey-40 rounded px-3 py-2 dark:bg-grey-80 dark:text-grey-10"
          />
        </label>
        <label class="mb-4">
          <span class="block text-sm font-semibold mb-1 dark:text-grey-20"
            >Password</span
          >
          <input
            type="password"
            name="password"
            required
            minlength="10"
            autocomplete=${isSignup ? 'new-password' : 'current-password'}
            class="w-full border border-grey-40 rounded px-3 py-2 dark:bg-grey-80 dark:text-grey-10"
          />
        </label>
        ${turnstileSiteKey
          ? html`
              <div
                class="cf-turnstile mb-4"
                data-sitekey=${turnstileSiteKey}
              ></div>
              <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
            `
          : ''}
        <button type="submit" class="btn btn-main">
          ${isSignup ? 'Sign up' : 'Log in'}
        </button>
      </form>
      <p class="mt-4 text-sm dark:text-grey-30">
        ${isSignup ? 'Already have an account?' : 'New to SendSmith?'}
        <a href="#" onclick=${switchMode} class="link-blue">
          ${isSignup ? 'Log in' : 'Sign up'}
        </a>
      </p>
      <button onclick=${close} class="mt-2 text-sm link-grey">
        Cancel
      </button>
    </send-auth-dialog>
  `;
}
