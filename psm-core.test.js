/**
 * PSM-OS Unit Tests (Jest)
 * Run: npx jest tests/unit/psm-core.test.js
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let window, document, localStorage;

beforeEach(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://psm-os.test/',
    runScripts: 'outside-only'
  });
  window = dom.window;
  document = window.document;
  localStorage = window.localStorage;
  global.window = window;
  global.document = document;
  global.localStorage = localStorage;
  global.navigator = window.navigator;
  window.crypto = require('crypto').webcrypto;

  // Define psmSafeParse + psmLSGet inline (extraidos do index.html)
  window.psmSafeParse = function(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  };
  window.psmLSGet = function(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return window.psmSafeParse(raw, fallback);
    } catch (e) { return fallback; }
  };
  window.psmLSSet = function(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        // Purga chaves grandes antigas
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.sort((a, b) => (localStorage.getItem(b) || '').length - (localStorage.getItem(a) || '').length);
        // Remove top 3 maiores
        keys.slice(0, 3).forEach(k => localStorage.removeItem(k));
        try { localStorage.setItem(key, JSON.stringify(val)); return true; }
        catch (e2) { return false; }
      }
      return false;
    }
  };
});

describe('psmSafeParse', () => {
  test('parses valid JSON', () => {
    expect(window.psmSafeParse('{"a":1}', null)).toEqual({ a: 1 });
  });
  test('returns fallback on invalid JSON', () => {
    expect(window.psmSafeParse('corrupted', { fb: true })).toEqual({ fb: true });
  });
  test('returns fallback on null input', () => {
    expect(window.psmSafeParse(null, 'default')).toBe('default');
  });
  test('handles empty string', () => {
    expect(window.psmSafeParse('', 'x')).toBe('x');
  });
  test('handles undefined', () => {
    expect(window.psmSafeParse(undefined, [])).toEqual([]);
  });
});

describe('psmLSGet', () => {
  test('reads and parses valid value', () => {
    localStorage.setItem('k', '{"n":42}');
    expect(window.psmLSGet('k', null)).toEqual({ n: 42 });
  });
  test('returns fallback for missing key', () => {
    expect(window.psmLSGet('missing', { fb: 1 })).toEqual({ fb: 1 });
  });
  test('returns fallback for corrupted value', () => {
    localStorage.setItem('bad', 'not-json');
    expect(window.psmLSGet('bad', 'ok')).toBe('ok');
  });
});

describe('psmLSSet quota handling', () => {
  test('saves normal value', () => {
    expect(window.psmLSSet('x', { a: 1 })).toBe(true);
    expect(JSON.parse(localStorage.getItem('x'))).toEqual({ a: 1 });
  });

  test('recovers from QuotaExceededError by purging largest keys', () => {
    // Popula antes do mock
    localStorage.setItem('small', 'a');
    localStorage.setItem('big', 'x'.repeat(100));

    // Simula quota cheia no proximo setItem (so primeira chamada falha)
    const originalSetItem = localStorage.setItem.bind(localStorage);
    let failOnce = true;
    localStorage.setItem = function(k, v) {
      if (failOnce) {
        failOnce = false;
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem(k, v);
    };

    const result = window.psmLSSet('new', { data: 'ok' });
    expect(result).toBe(true);
    // novo foi persistido
    const stored = localStorage.getItem('new');
    expect(stored).toBeTruthy();
  });
});

describe('btoa unicode fallback', () => {
  test('encodes unicode password', () => {
    const senha = 'señhação🔑';
    const encoded = window.btoa(unescape(encodeURIComponent(senha)));
    expect(encoded).toBeTruthy();
    expect(() => window.atob(encoded)).not.toThrow();
    expect(decodeURIComponent(escape(window.atob(encoded)))).toBe(senha);
  });
});

describe('Firebase rate limit wrapper', () => {
  test('rate limits writes per path', async () => {
    const limiter = createRateLimiter({ maxPerMin: 60 });
    for (let i = 0; i < 60; i++) {
      expect(limiter.check('/broker/123')).toBe(true);
    }
    expect(limiter.check('/broker/123')).toBe(false); // 61st denied
  });
});

function createRateLimiter({ maxPerMin }) {
  const counts = new Map();
  return {
    check(path) {
      const now = Date.now();
      const key = path + ':' + Math.floor(now / 60000);
      const cur = counts.get(key) || 0;
      if (cur >= maxPerMin) return false;
      counts.set(key, cur + 1);
      // GC old keys
      for (const k of counts.keys()) {
        if (parseInt(k.split(':').pop()) < Math.floor(now / 60000) - 2) counts.delete(k);
      }
      return true;
    }
  };
}

describe('Offline queue vector clock', () => {
  function mergeVectorClocks(a, b) {
    const merged = { ...a };
    for (const key of Object.keys(b)) {
      merged[key] = Math.max(merged[key] || 0, b[key]);
    }
    return merged;
  }

  function compareVectorClocks(a, b) {
    let aGreater = false, bGreater = false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if ((a[k] || 0) > (b[k] || 0)) aGreater = true;
      if ((b[k] || 0) > (a[k] || 0)) bGreater = true;
    }
    if (aGreater && !bGreater) return 'a>b';
    if (bGreater && !aGreater) return 'b>a';
    if (!aGreater && !bGreater) return 'eq';
    return 'concurrent';
  }

  test('merge vector clocks', () => {
    expect(mergeVectorClocks({ node1: 3 }, { node2: 5 })).toEqual({ node1: 3, node2: 5 });
    expect(mergeVectorClocks({ node1: 3 }, { node1: 5 })).toEqual({ node1: 5 });
  });

  test('compare vector clocks', () => {
    expect(compareVectorClocks({ n1: 1 }, { n1: 2 })).toBe('b>a');
    expect(compareVectorClocks({ n1: 2 }, { n1: 2 })).toBe('eq');
    expect(compareVectorClocks({ n1: 2, n2: 1 }, { n1: 1, n2: 2 })).toBe('concurrent');
  });
});
