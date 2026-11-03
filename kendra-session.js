/**
 * Shared sign-in for the Kendra hub and both assessments.
 * The hub collects the details once and stores them for this browser tab;
 * each assessment reads them instead of showing its own login screen.
 */
'use strict';

const KendraSession = {
  KEY: 'kendra_login',

  get() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.KEY));
      return s && s.name && s.email && s.passcode ? s : null;
    } catch (err) {
      return null;
    }
  },

  set(login) {
    try {
      sessionStorage.setItem(this.KEY, JSON.stringify(login));
      return true;
    } catch (err) {
      return false;
    }
  },

  clear() {
    try { sessionStorage.removeItem(this.KEY); } catch (err) { /* ignore */ }
  },
};
