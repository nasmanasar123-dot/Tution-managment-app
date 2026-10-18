// Small progressive enhancements; every page works without this script.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Confirm dialogs for destructive forms.
  $$('form[data-confirm]').forEach(f => f.addEventListener('submit', e => {
    if (!confirm(f.dataset.confirm)) e.preventDefault();
  }));

  // Prevent double submits (e.g. recording a payment twice).
  $$('form[method=post]').forEach(f => f.addEventListener('submit', e => {
    if (e.defaultPrevented) return;
    setTimeout(() => $$('button', f).forEach(b => { if (!b.name) b.disabled = true; }), 0);
  }));
  window.addEventListener('pageshow', () => $$('form button:disabled').forEach(b => { b.disabled = false; }));

  // Quick collect: live student search.
  const search = $('#student-search');
  if (search) {
    const results = $('#search-results');
    const recent = $('#recent-block');
    const run = debounce(async () => {
      const q = search.value.trim();
      if (recent) recent.hidden = q.length > 0;
      if (!q) { results.innerHTML = ''; return; }
      const res = await fetch('/api/students?q=' + encodeURIComponent(q));
      const rows = await res.json();
      results.innerHTML = rows.length
        ? rows.map(s => `<li><a class="list-main" href="/collect/${s.id}"><strong>${esc(s.name)}</strong>
            <span class="muted small">Class ${s.class}-${esc(s.division)}${s.roll_no ? ' · Roll ' + esc(s.roll_no) : ''}${s.phone ? ' · ' + esc(s.phone) : ''}</span></a><span class="chev">&rsaquo;</span></li>`).join('')
        : '<li class="muted">No matching active student.</li>';
    }, 200);
    search.addEventListener('input', run);
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = $('a', results); if (first) { e.preventDefault(); location.href = first.href; } }
    });
  }

  // Collect form: quick amounts + live "covers" preview.
  const collect = $('#collect-form');
  if (collect) {
    const amount = $('#amount');
    const covers = $('#covers');
    const update = debounce(async () => {
      const v = Math.round(Number(amount.value));
      if (!(v > 0)) { covers.textContent = '–'; return; }
      const res = await fetch(`/api/coverage?student=${collect.dataset.student}&amount=${v}`);
      covers.textContent = (await res.json()).covers || '–';
    }, 250);
    $$('[data-amount]', collect).forEach(b => b.addEventListener('click', () => { amount.value = b.dataset.amount; update(); }));
    amount.addEventListener('input', update);
    update();
  }

  // Attendance: counts and all/none shortcuts.
  const att = $('#attendance-form');
  if (att) {
    const boxes = $$('input[name=present]', att);
    const count = () => {
      const p = boxes.filter(b => b.checked).length;
      $('#present-count').textContent = p;
      $('#absent-count').textContent = boxes.length - p;
    };
    boxes.forEach(b => b.addEventListener('change', count));
    $$('[data-mark]', att).forEach(btn => btn.addEventListener('click', () => {
      boxes.forEach(b => { b.checked = btn.dataset.mark === 'all'; });
      count();
    }));
    count();
  }
})();
