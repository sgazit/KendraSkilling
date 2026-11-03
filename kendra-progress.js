/**
 * Saves and reads in-progress assessment state through each assessment's
 * existing Apps Script receiver (its "Progress" tab). Saves are fire-and-forget:
 * a failed save never interrupts the assessment, localStorage stays the primary copy.
 */
'use strict';

const KendraProgress = {
  /**
   * record: { name, email, status, answered, total, startedAt, completedAt?, ndaApprovedAt, state }
   * status: 'in_progress' | 'completed'
   */
  save(url, passcode, record) {
    if (!url) return Promise.resolve(false);
    try {
      return fetch(url, {
        method:    'POST',
        // text/plain keeps this a CORS "simple request" (no preflight Apps Script can't answer).
        headers:   { 'Content-Type': 'text/plain;charset=utf-8' },
        body:      JSON.stringify(Object.assign({ type: 'progress', key: passcode }, record)),
        keepalive: true,  // lets a save sent from pagehide finish after the tab closes
      }).then(function (res) { return res.ok; }, function () { return false; });
    } catch (err) {
      return Promise.resolve(false);
    }
  },

  /** Returns the saved record for this email, or null (none saved, or the call failed). */
  async load(url, passcode, email) {
    if (!url) return null;
    try {
      const res  = await fetch(url + '?action=progress&key=' + encodeURIComponent(passcode) +
                               '&email=' + encodeURIComponent(email));
      const data = await res.json();
      return (data && data.progress) || null;
    } catch (err) {
      return null;
    }
  },
};
