import assets from '../common/assets';
import { getFileList, setFileList } from './api';
import auth from './auth';
import { encryptStream, decryptStream } from './ece';
import { arrayToB64, b64ToArray, streamToArrayBuffer } from './utils';
import { blobStream } from './streams';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const anonId = arrayToB64(crypto.getRandomValues(new Uint8Array(16)));

async function hashId(id) {
  const d = new Date();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const encoded = textEncoder.encode(`${id}:${year}:${month}`);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return arrayToB64(new Uint8Array(hash.slice(16)));
}

// SendSmith account state for the browser app.
//
// This class used to integrate Firefox Accounts (OAuth + scoped-keys
// bundle). Accounts are now SendSmith's own (server/users.js):
// sessions live in an httpOnly cookie, and `info` here is a cached
// copy of /api/auth/me ({ email, tier, loggedIn }).
//
// The file-list encryption key changed provenance, not properties: it
// is still a random 16-byte secret the server never sees (the server
// stores only ECE ciphertext under a key-id derived from it). Instead
// of arriving via an FxA keys bundle, it is generated locally once and
// kept in browser storage — so the synced file list is per-browser
// rather than per-account. See docs/UPGRADING.md.
export default class User {
  constructor(storage, limits, authConfig) {
    this.authConfig = authConfig;
    this.limits = limits;
    this.storage = storage;
    this.data = storage.user || {};
  }

  get info() {
    return this.data || this.storage.user || {};
  }

  set info(data) {
    this.data = data;
    this.storage.user = data;
  }

  get firstAction() {
    return this.storage.get('firstAction');
  }

  set firstAction(action) {
    this.storage.set('firstAction', action);
  }

  get surveyed() {
    return this.storage.get('surveyed');
  }

  set surveyed(yes) {
    this.storage.set('surveyed', yes);
  }

  get avatar() {
    return assets.get('user.svg');
  }

  get name() {
    return this.info.displayName;
  }

  get email() {
    return this.info.email;
  }

  get loggedIn() {
    return !!this.info.loggedIn;
  }

  get isPro() {
    return this.info.tier === 'pro';
  }

  // No bearer tokens anymore: the session cookie authenticates API
  // calls and the WebSocket upgrade. Kept as a null accessor so
  // existing call sites (file upload) stay harmless.
  get bearerToken() {
    return null;
  }

  get maxSize() {
    return this.loggedIn
      ? this.limits.MAX_FILE_SIZE
      : this.limits.ANON.MAX_FILE_SIZE;
  }

  get maxExpireSeconds() {
    return this.loggedIn
      ? this.limits.MAX_EXPIRE_SECONDS
      : this.limits.ANON.MAX_EXPIRE_SECONDS;
  }

  get maxDownloads() {
    return this.loggedIn
      ? this.limits.MAX_DOWNLOADS
      : this.limits.ANON.MAX_DOWNLOADS;
  }

  // Accounts are optional: nothing in the app requires login.
  get loginRequired() {
    return false;
  }

  async metricId() {
    return this.loggedIn ? hashId(this.info.email) : undefined;
  }

  async deviceId() {
    return this.loggedIn ? hashId(this.storage.id) : hashId(anonId);
  }

  async login(email, password, botToken) {
    await auth.login(email, password, botToken);
    await this.refresh();
  }

  async signup(email, password, botToken) {
    await auth.signup(email, password, botToken);
    await this.refresh();
  }

  // Refresh the cached account state from the session cookie.
  // Returns true when a valid session exists.
  async refresh() {
    try {
      const me = await auth.me();
      if (me && me.loggedIn) {
        this.info = {
          email: me.email,
          tier: me.tier,
          loggedIn: true
        };
        return true;
      }
    } catch (e) {
      // no session / accounts unreachable — treat as logged out
    }
    this.info = {};
    return false;
  }

  async logout() {
    try {
      await auth.logout();
    } catch (e) {
      // oh well, we tried
    }
    this.storage.clearLocalFiles();
    this.info = {};
  }

  async startCheckout() {
    return auth.checkout();
  }

  async openPortal() {
    return auth.portal();
  }

  fileListSecret() {
    let secret = this.storage.get('fileListSecret');
    if (!secret) {
      secret = arrayToB64(crypto.getRandomValues(new Uint8Array(16)));
      this.storage.set('fileListSecret', secret);
    }
    return secret;
  }

  async syncFileList() {
    let changes = { incoming: false, outgoing: false, downloadCount: false };
    if (!this.loggedIn) {
      return this.storage.merge();
    }
    let list = [];
    const key = b64ToArray(this.fileListSecret());
    const sha = await crypto.subtle.digest('SHA-256', key);
    const kid = arrayToB64(new Uint8Array(sha)).substring(0, 16);
    try {
      const encrypted = await getFileList(kid);
      const decrypted = await streamToArrayBuffer(
        decryptStream(blobStream(encrypted), key)
      );
      list = JSON.parse(textDecoder.decode(decrypted));
    } catch (e) {
      if (e.message === '401') {
        // session expired — drop the cached login and keep local files
        this.info = {};
        return { incoming: true };
      }
    }
    changes = await this.storage.merge(list);
    if (!changes.outgoing) {
      return changes;
    }
    try {
      const blob = new Blob([
        textEncoder.encode(JSON.stringify(this.storage.files))
      ]);
      const encrypted = await streamToArrayBuffer(
        encryptStream(blobStream(blob), key)
      );
      await setFileList(kid, encrypted);
    } catch (e) {
      if (e.message === '401') {
        this.info = {};
        return { incoming: true };
      }
    }
    return changes;
  }

  toJSON() {
    return this.info;
  }
}
