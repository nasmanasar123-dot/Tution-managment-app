// Fee model: each active student is charged their batch's monthly fee for every
// month from fee_start_month to the current month (rows in `dues`). Payments are
// not tied to specific months; they are applied oldest-month-first, so
// pending = total dues - total paid, and any surplus is advance credit.

const { db, getSettings } = require('./db');
const { currentMonth, addMonths, monthRange, monthLabel } = require('./util');

const insertDue = db.prepare('INSERT OR IGNORE INTO dues (student_id, month, amount) VALUES (?, ?, ?)');

// Create any missing due rows up to the current month. Cheap enough to run per request.
const ensureDues = db.transaction((studentId) => {
  const now = currentMonth();
  const rows = db.prepare(`
    SELECT s.id, s.fee_start_month, b.monthly_fee
    FROM students s JOIN batches b ON b.id = s.batch_id
    WHERE s.active = 1 ${studentId ? 'AND s.id = ?' : ''}
  `).all(...(studentId ? [studentId] : []));
  for (const s of rows) {
    if (s.fee_start_month > now) continue;
    for (const m of monthRange(s.fee_start_month, now)) insertDue.run(s.id, m, s.monthly_fee);
  }
});

const totalsStmt = db.prepare(`
  SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM dues WHERE student_id = ? AND waived = 0) AS due,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE student_id = ? AND voided = 0) AS paid
`);

function totals(studentId) {
  const t = totalsStmt.get(studentId, studentId);
  return { ...t, pending: Math.max(0, t.due - t.paid), credit: Math.max(0, t.paid - t.due) };
}

// Per-month status, applying payments oldest first.
function monthStatus(studentId) {
  const dues = db.prepare('SELECT * FROM dues WHERE student_id = ? ORDER BY month').all(studentId);
  let left = totals(studentId).paid;
  return dues.map(d => {
    if (d.waived) return { ...d, paid: 0, status: 'waived' };
    const paid = Math.min(left, d.amount);
    left -= paid;
    return { ...d, paid, status: paid === d.amount ? 'paid' : paid > 0 ? 'partial' : 'due' };
  });
}

// Which months a new payment of `amount` would cover, e.g. "Jun 2026 - Aug 2026".
// Amounts beyond existing dues are projected onto future months at the current fee.
function coverage(studentId, amount, monthlyFee) {
  const dues = db.prepare('SELECT month, amount FROM dues WHERE student_id = ? AND waived = 0 ORDER BY month').all(studentId);
  let before = totals(studentId).paid;
  const covered = [];
  let start = 0;
  const lastMonth = db.prepare('SELECT MAX(month) m FROM dues WHERE student_id = ?').get(studentId).m;
  let future = lastMonth ? addMonths(lastMonth, 1) : currentMonth();
  const end = before + amount;
  let i = 0;
  while (start < end) {
    let month, amt;
    if (i < dues.length) ({ month, amount: amt } = dues[i++]);
    else if (monthlyFee > 0) { month = future; amt = monthlyFee; future = addMonths(future, 1); }
    else break;
    const stop = start + amt;
    if (stop > before) covered.push({ month, full: end >= stop && before <= start });
    start = stop;
    if (covered.length > 36) break;
  }
  if (!covered.length) return 'Advance';
  const first = covered[0], last = covered[covered.length - 1];
  const label = c => monthLabel(c.month) + (c.full ? '' : ' (part)');
  return covered.length === 1 ? label(first) : `${label(first)} - ${label(last)}`;
}

function nextReceiptNo() {
  const { receipt_prefix } = getSettings();
  const n = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 n FROM payments').get().n;
  return `${receipt_prefix || 'R'}-${String(n).padStart(5, '0')}`;
}

const recordPayment = db.transaction(({ student, amount, paid_on, method, note }) => {
  ensureDues(student.id);
  const covers = coverage(student.id, amount, student.monthly_fee);
  const info = db.prepare(`
    INSERT INTO payments (receipt_no, student_id, batch_id, amount, paid_on, method, covers, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nextReceiptNo(), student.id, student.batch_id, amount, paid_on, method, covers, note || null);
  return info.lastInsertRowid;
});

// Pending per active student (call ensureDues() first).
function pendingList({ batchId, classNo } = {}) {
  const where = ['s.active = 1'];
  const params = [];
  if (batchId) { where.push('s.batch_id = ?'); params.push(batchId); }
  if (classNo) { where.push('b.class = ?'); params.push(classNo); }
  return db.prepare(`
    SELECT s.id, s.name, s.roll_no, s.phone, s.parent_name, b.class, b.division, b.monthly_fee,
      COALESCE((SELECT SUM(amount) FROM dues d WHERE d.student_id = s.id AND d.waived = 0), 0)
      - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id AND p.voided = 0), 0) AS balance
    FROM students s JOIN batches b ON b.id = s.batch_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.class, b.division, s.name
  `).all(...params).map(r => ({ ...r, pending: Math.max(0, r.balance) }));
}

module.exports = { ensureDues, totals, monthStatus, coverage, recordPayment, pendingList };
