/* Message Sorter - user interface. Everything runs locally in the browser. */
(function () {
  'use strict';

  var S = window.Sorter;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    input: $('input'),
    lineCount: $('lineCount'),
    autoSort: $('autoSort'),
    stripPrefix: $('stripPrefix'),
    skipDupes: $('skipDupes'),
    sortBtn: $('sortBtn'),
    pasteBtn: $('pasteBtn'),
    clearBtn: $('clearBtn'),
    installBtn: $('installBtn'),
    search: $('search'),
    copyAll: $('copyAll'),
    exportBtn: $('exportBtn'),
    collapseAll: $('collapseAll'),
    results: $('results'),
    resultNote: $('resultNote'),
    resultsPanel: $('resultsPanel'),
    staleNote: $('staleNote'),
    invalidBox: $('invalidBox'),
    invalidTitle: $('invalidTitle'),
    invalidList: $('invalidList'),
    statTotal: $('statTotal'),
    statGroups: $('statGroups'),
    statDupes: $('statDupes'),
    statInvalid: $('statInvalid'),
    toast: $('toast')
  };

  var STORAGE_KEY = 'messageSorter.v1';
  var INVALID_SHOWN_LIMIT = 500;
  var EXAMPLE = [
    '3 - 250', '4 - 400', '3-250', '5 - 600', '12 - 300', '125 - 900',
    '13 - 150', '103 - 220', '23- 75', '3 -250', '4 - 400', '3 - 100',
    'hello, this line is not an entry'
  ].join('\n');

  var state = {
    result: S.process(''),
    visible: [],
    collapsed: new Set(),
    dirty: false
  };

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmt(n) { return n.toLocaleString(); }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  var toastTimer;
  function hideToast() { els.toast.hidden = true; }
  function toast(msg, action) {
    els.toast.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    els.toast.appendChild(span);
    if (action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = action.label;
      b.addEventListener('click', function () { action.run(); hideToast(); });
      els.toast.appendChild(b);
    }
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6000 : 2400);
  }

  function flash(btn, text) {
    var label = btn.querySelector('.label') || btn;
    if (!btn.dataset.label) btn.dataset.label = label.textContent;
    label.textContent = text;
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(function () { label.textContent = btn.dataset.label; }, 1400);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ---------- persistence ---------- */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        input: els.input.value,
        auto: els.autoSort.checked,
        strip: els.stripPrefix.checked,
        skip: els.skipDupes.checked
      }));
    } catch (e) { /* storage unavailable: ignore */ }
  }
  var saveSoon = debounce(save, 400);

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (typeof d.input === 'string') els.input.value = d.input;
      if (typeof d.auto === 'boolean') els.autoSort.checked = d.auto;
      if (typeof d.strip === 'boolean') els.stripPrefix.checked = d.strip;
      if (typeof d.skip === 'boolean') els.skipDupes.checked = d.skip;
    } catch (e) { /* ignore */ }
  }

  /* ---------- processing and rendering ---------- */

  function sortNow() {
    state.result = S.process(els.input.value, { stripPrefix: els.stripPrefix.checked });
    state.dirty = false;
    render();
  }

  function render() {
    var r = state.result;
    els.statTotal.textContent = fmt(r.total);
    els.statGroups.textContent = fmt(r.groups.length);
    els.statDupes.textContent = fmt(r.duplicates);
    els.statInvalid.textContent = fmt(r.invalid.length);
    els.statDupes.parentNode.classList.toggle('is-flagged', r.duplicates > 0);
    els.statInvalid.parentNode.classList.toggle('is-bad', r.invalid.length > 0);

    renderResults();
    renderInvalid();
    renderStale();
  }

  function renderStale() {
    els.staleNote.hidden = !(state.dirty && !els.autoSort.checked);
  }

  function groupHTML(g) {
    var collapsed = state.collapsed.has(g.key);
    var n = g.items.length;
    var h = '<article class="group' + (collapsed ? ' is-collapsed' : '') + '" data-key="' + g.key + '">' +
      '<div class="group-head">' +
      '<button type="button" class="group-toggle" data-action="toggle" aria-expanded="' + (!collapsed) + '">' +
      '<span class="chev" aria-hidden="true"></span>' +
      '<span class="group-num">' + g.key + '</span>' +
      '<span class="group-count">' + plural(n, 'message') + '</span>' +
      '</button>' +
      '<button type="button" class="btn btn-sm" data-action="copy-group" data-key="' + g.key + '" aria-label="Copy group ' + g.key + '">Copy</button>' +
      '</div><ul class="msgs">';
    for (var i = 0; i < n; i++) {
      var it = g.items[i];
      h += '<li class="msg' + (it.dupCount > 1 ? ' is-dup' : '') + '"><span class="msg-text">' + esc(it.text) + '</span>';
      if (it.dupCount > 1) h += '<span class="tag">Duplicate &times;' + it.dupCount + '</span>';
      h += '</li>';
    }
    return h + '</ul></article>';
  }

  function emptyHTML(kind, query) {
    if (kind === 'blank') {
      return '<div class="empty"><strong>Nothing to sort yet</strong>Paste your messages into the input box and they will be grouped here.' +
        '<br><button type="button" class="btn" data-action="example">Load example</button></div>';
    }
    if (kind === 'none') {
      return '<div class="empty"><strong>No valid entries found</strong>Each line should start with a number followed by a dash, for example 3 - 250.</div>';
    }
    return '<div class="empty"><strong>No group found</strong>Nothing matches &ldquo;' + esc(query) + '&rdquo;. Search uses the full number, so 3 does not match 13 or 103.</div>';
  }

  function renderResults() {
    var r = state.result;
    var query = els.search.value;
    var keys = S.parseKeyList(query);
    var list = keys ? r.groups.filter(function (g) { return keys.has(g.key); }) : r.groups;
    state.visible = list;

    var none = list.length === 0;
    els.copyAll.disabled = none;
    els.exportBtn.disabled = none;
    els.collapseAll.disabled = none;

    if (none) {
      var kind = keys ? 'search' : (els.input.value.trim() ? 'none' : 'blank');
      if (keys && r.groups.length === 0) kind = els.input.value.trim() ? 'none' : 'blank';
      els.results.innerHTML = emptyHTML(kind, query.trim());
      els.resultNote.textContent = '';
    } else {
      var parts = new Array(list.length);
      for (var i = 0; i < list.length; i++) parts[i] = groupHTML(list[i]);
      els.results.innerHTML = parts.join('');
      els.resultNote.textContent = keys
        ? 'Showing ' + list.length + ' of ' + plural(r.groups.length, 'group')
        : plural(list.length, 'group') + ', ascending';
    }
    updateCollapseLabel();
  }

  function renderInvalid() {
    var inv = state.result.invalid;
    els.invalidBox.hidden = inv.length === 0;
    if (!inv.length) { els.invalidList.textContent = ''; return; }
    els.invalidTitle.textContent = plural(inv.length, 'invalid line');
    var shown = inv.slice(0, INVALID_SHOWN_LIMIT);
    var h = '';
    for (var i = 0; i < shown.length; i++) {
      h += '<li><span class="ln">Line ' + shown[i].line + '</span><span class="tx">' + esc(shown[i].text) + '</span></li>';
    }
    if (inv.length > shown.length) {
      h += '<li><span class="tx muted">and ' + fmt(inv.length - shown.length) + ' more</span></li>';
    }
    els.invalidList.innerHTML = h;
  }

  function updateCollapseLabel() {
    var list = state.visible;
    var all = list.length > 0 && list.every(function (g) { return state.collapsed.has(g.key); });
    els.collapseAll.textContent = all ? 'Expand all' : 'Collapse all';
  }

  function updateMeta() {
    var v = els.input.value;
    var count = 0;
    if (v) {
      var lines = v.split(/\r\n|\r|\n/);
      for (var i = 0; i < lines.length; i++) if (lines[i].trim()) count++;
    }
    els.lineCount.textContent = plural(count, 'line');
  }

  function updateSortButton() {
    els.sortBtn.hidden = els.autoSort.checked;
  }

  /* ---------- actions ---------- */

  function onInputChanged() {
    updateMeta();
    saveSoon();
    if (els.autoSort.checked) autoSortSoon();
    else { state.dirty = true; renderStale(); }
  }
  var autoSortSoon = debounce(sortNow, 150);

  function copyGroup(key, btn) {
    var g = state.result.index.get(key);
    if (!g) return;
    Promise.resolve(copyText(S.formatGroup(g, els.skipDupes.checked))).then(function (ok) {
      if (ok) flash(btn, 'Copied');
      else toast('Copy failed. Select the text and copy it manually.');
    });
  }

  function copyAll() {
    if (!state.visible.length) return;
    var n = state.visible.length;
    Promise.resolve(copyText(S.formatGroups(state.visible, els.skipDupes.checked))).then(function (ok) {
      if (ok) { flash(els.copyAll, 'Copied'); toast('Copied ' + plural(n, 'group')); }
      else toast('Copy failed. Use Export TXT instead.');
    });
  }

  function dateStamp() {
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function exportTxt() {
    if (!state.visible.length) return;
    var text = S.formatGroups(state.visible, els.skipDupes.checked);
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sorted-messages-' + dateStamp() + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('Exported ' + plural(state.visible.length, 'group'));
  }

  function toggleGroup(card, toggleBtn) {
    var collapsed = card.classList.toggle('is-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) state.collapsed.add(card.dataset.key);
    else state.collapsed.delete(card.dataset.key);
    updateCollapseLabel();
  }

  function toggleAll() {
    var list = state.visible;
    var all = list.every(function (g) { return state.collapsed.has(g.key); });
    list.forEach(function (g) { if (all) state.collapsed.delete(g.key); else state.collapsed.add(g.key); });
    renderResults();
  }

  function loadExample() {
    els.input.value = EXAMPLE;
    updateMeta();
    save();
    sortNow();
  }

  function clearAll() {
    var prev = els.input.value;
    var prevSearch = els.search.value;
    if (!prev && !prevSearch) return;
    els.input.value = '';
    els.search.value = '';
    state.collapsed.clear();
    updateMeta();
    sortNow();
    save();
    toast('Cleared', {
      label: 'Undo',
      run: function () {
        els.input.value = prev;
        els.search.value = prevSearch;
        updateMeta();
        sortNow();
        save();
      }
    });
  }

  function pasteFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast('Paste is not available here. Long-press the box and choose Paste.');
      return;
    }
    navigator.clipboard.readText().then(function (t) {
      if (!t) { toast('The clipboard is empty'); return; }
      var cur = els.input.value;
      els.input.value = cur && !/\n$/.test(cur) ? cur + '\n' + t : cur + t;
      onInputChanged();
    }, function () {
      toast('Clipboard access was blocked. Long-press the box and choose Paste.');
    });
  }

  /* ---------- wiring ---------- */

  els.input.addEventListener('input', onInputChanged);
  els.autoSort.addEventListener('change', function () {
    updateSortButton();
    if (els.autoSort.checked) sortNow(); else renderStale();
    save();
  });
  els.stripPrefix.addEventListener('change', function () {
    if (els.autoSort.checked) sortNow(); else { state.dirty = true; renderStale(); }
    save();
  });
  els.skipDupes.addEventListener('change', save);

  els.sortBtn.addEventListener('click', function () {
    sortNow();
    if (window.matchMedia('(max-width: 899px)').matches) {
      els.resultsPanel.scrollIntoView({ block: 'start' });
    }
  });
  els.search.addEventListener('input', debounce(renderResults, 100));

  els.pasteBtn.addEventListener('click', pasteFromClipboard);
  els.clearBtn.addEventListener('click', clearAll);
  els.copyAll.addEventListener('click', copyAll);
  els.exportBtn.addEventListener('click', exportTxt);
  els.collapseAll.addEventListener('click', toggleAll);

  els.results.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.dataset.action;
    if (action === 'toggle') toggleGroup(t.closest('.group'), t);
    else if (action === 'copy-group') copyGroup(t.dataset.key, t);
    else if (action === 'example') loadExample();
  });

  /* ---------- PWA ---------- */

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener('click', function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      els.installBtn.hidden = true;
    });
  });
  window.addEventListener('appinstalled', function () { els.installBtn.hidden = true; });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
    });
  }

  /* ---------- start ---------- */

  restore();
  updateMeta();
  updateSortButton();
  sortNow();
})();
