/*
 * Message Sorter - core logic.
 * Pure functions only: no DOM access, so it can run in the browser or in Node.
 *
 * Grouping rule: a message belongs to the group named by the COMPLETE number
 * before the first dash. 3, 13, 23 and 103 are always four separate groups.
 * Whatever comes after the dash is never used for grouping or ordering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sorter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Invisible direction marks that WhatsApp and some keyboards insert.
  var INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

  // digits, optional spaces, the first dash (hyphen, en dash, em dash, minus), the rest.
  var ENTRY = /^(\d+)\s*[-\u2010-\u2015\u2212]\s*(.*)$/;

  // Optional WhatsApp export prefix, e.g. "[10:15 am, 06/11/2026] Name: " or
  // "06/11/2026, 10:15 - Name: ". Only removed when the option is on.
  var DATE = '\\d{1,4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,4}';
  var TIME = '\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:[ap]\\.?\\s?m\\.?)?';
  var PREFIX = new RegExp(
    '^\\[?(?:' + DATE + ',?\\s*' + TIME + '|' + TIME + ',?\\s*' + DATE + ')\\]?' +
    '\\s*(?:[-\\u2010-\\u2015]\\s*)?(?!\\d)[^:\\n]{1,60}?:\\s*',
    'i'
  );

  // Keys are kept as digit strings so numbers of any length compare exactly.
  function normalizeKey(digits) {
    return String(digits).replace(/^0+(?=\d)/, '');
  }

  // Numeric comparison of two normalized digit strings.
  function compareKeys(a, b) {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function process(text, opts) {
    opts = opts || {};
    var lines = String(text || '').split(/\r\n|\r|\n/);
    var map = new Map();
    var invalid = [];
    var total = 0;
    var nonEmpty = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(INVISIBLE, '').trim();
      if (!line) continue;
      nonEmpty++;

      var body = line;
      if (opts.stripPrefix) {
        var p = PREFIX.exec(body);
        if (p) body = body.slice(p[0].length).trim();
      }

      var m = ENTRY.exec(body);
      if (!m) {
        invalid.push({ line: i + 1, text: line });
        continue;
      }

      var key = normalizeKey(m[1]);
      var group = map.get(key);
      if (!group) {
        group = { key: key, items: [] };
        map.set(key, group);
      }
      group.items.push({
        text: body,
        line: i + 1,
        // Same group number + same text after the dash (spacing and case ignored)
        norm: key + '|' + m[2].replace(/\s+/g, ' ').trim().toLowerCase(),
        first: true,
        dupCount: 1
      });
      total++;
    }

    var groups = Array.from(map.values()).sort(function (a, b) {
      return compareKeys(a.key, b.key);
    });

    // Duplicate detection: flag, never remove.
    var counts = new Map();
    var g, j;
    for (g = 0; g < groups.length; g++) {
      for (j = 0; j < groups[g].items.length; j++) {
        var n = groups[g].items[j].norm;
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    var seen = new Set();
    var extras = 0;
    for (g = 0; g < groups.length; g++) {
      for (j = 0; j < groups[g].items.length; j++) {
        var it = groups[g].items[j];
        it.dupCount = counts.get(it.norm);
        if (seen.has(it.norm)) {
          it.first = false;
          extras++;
        } else {
          seen.add(it.norm);
        }
      }
    }

    var index = new Map();
    groups.forEach(function (x) { index.set(x.key, x); });

    return {
      groups: groups,
      index: index,
      total: total,
      nonEmpty: nonEmpty,
      invalid: invalid,
      duplicates: extras
    };
  }

  // Search box text -> Set of normalized group numbers, or null when empty.
  // Accepts "3", "3, 12" or "3 12"; anything after the first digits of a token is ignored.
  function parseKeyList(query) {
    var tokens = String(query || '').trim().split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return null;
    var keys = new Set();
    tokens.forEach(function (t) {
      var m = /^(\d+)/.exec(t);
      if (m) keys.add(normalizeKey(m[1]));
    });
    return keys;
  }

  function formatGroup(group, skipRepeats) {
    var items = skipRepeats
      ? group.items.filter(function (i) { return i.first; })
      : group.items;
    var head = 'Group ' + group.key + ' (' + items.length +
      (items.length === 1 ? ' message)' : ' messages)');
    return [head].concat(items.map(function (i) { return i.text; })).join('\n');
  }

  function formatGroups(groups, skipRepeats) {
    if (!groups.length) return '';
    return groups.map(function (g) { return formatGroup(g, skipRepeats); }).join('\n\n') + '\n';
  }

  return {
    process: process,
    parseKeyList: parseKeyList,
    normalizeKey: normalizeKey,
    compareKeys: compareKeys,
    formatGroup: formatGroup,
    formatGroups: formatGroups
  };
});
