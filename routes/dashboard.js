const express = require('express');
const { db } = require('../lib/db');
const { ensureDues, pendingList } = require('../lib/fees');
const { today, currentMonth, addMonths, monthLabel } = require('../lib/util');

const router = express.Router();

router.get('/', (req, res) => {
  ensureDues();
  const t = today();
  const m = currentMonth();
  const sum = (sql, ...p) => db.prepare(sql).get(...p).n || 0;

  const stats = {
    today: sum('SELECT SUM(amount) n FROM payments WHERE voided = 0 AND paid_on = ?', t),
    todayCount: sum('SELECT COUNT(*) n FROM payments WHERE voided = 0 AND paid_on = ?', t),
    month: sum("SELECT SUM(amount) n FROM payments WHERE voided = 0 AND substr(paid_on, 1, 7) = ?", m),
    lastMonth: sum("SELECT SUM(amount) n FROM payments WHERE voided = 0 AND substr(paid_on, 1, 7) = ?", addMonths(m, -1)),
    expected: sum(`SELECT SUM(d.amount) n FROM dues d JOIN students s ON s.id = d.student_id
                   WHERE s.active = 1 AND d.waived = 0 AND d.month = ?`, m),
    students: sum('SELECT COUNT(*) n FROM students WHERE active = 1'),
  };

  const pending = pendingList().filter(p => p.pending > 0).sort((a, b) => b.pending - a.pending);
  stats.pending = pending.reduce((a, p) => a + p.pending, 0);
  stats.pendingCount = pending.length;

  // Last 6 months of collections for the chart.
  const months = Array.from({ length: 6 }, (_, i) => addMonths(m, i - 5));
  const byMonth = Object.fromEntries(db.prepare(`
    SELECT substr(paid_on, 1, 7) month, SUM(amount) total FROM payments
    WHERE voided = 0 AND paid_on >= ? GROUP BY month
  `).all(months[0] + '-01').map(r => [r.month, r.total]));
  const chart = { labels: months.map(monthLabel), values: months.map(x => byMonth[x] || 0) };

  // This month by class: collected vs this month's fees.
  const byClass = db.prepare(`
    SELECT b.class,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN batches pb ON pb.id = p.batch_id
                WHERE p.voided = 0 AND substr(p.paid_on, 1, 7) = ? AND pb.class = b.class), 0) collected,
      COALESCE((SELECT SUM(d.amount) FROM dues d JOIN students s ON s.id = d.student_id JOIN batches sb ON sb.id = s.batch_id
                WHERE d.month = ? AND d.waived = 0 AND s.active = 1 AND sb.class = b.class), 0) expected
    FROM batches b GROUP BY b.class ORDER BY b.class
  `).all(m, m);

  const methods = db.prepare(`
    SELECT method, SUM(amount) total FROM payments
    WHERE voided = 0 AND substr(paid_on, 1, 7) = ? GROUP BY method ORDER BY total DESC
  `).all(m);

  const attendance = db.prepare(`
    SELECT b.id, b.class, b.division,
      (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) total,
      (SELECT COUNT(*) FROM attendance a WHERE a.batch_id = b.id AND a.date = ? AND a.status = 'P') present,
      (SELECT COUNT(*) FROM attendance a WHERE a.batch_id = b.id AND a.date = ?) marked
    FROM batches b ORDER BY b.class, b.division
  `).all(t, t);

  const recent = db.prepare(`
    SELECT p.id, p.receipt_no, p.amount, p.paid_on, p.method, s.name, s.id student_id, b.class, b.division
    FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = p.batch_id
    WHERE p.voided = 0 ORDER BY p.id DESC LIMIT 6
  `).all();

  res.render('dashboard', {
    title: 'Dashboard', stats, chart, byClass, methods, attendance, recent, pending: pending.slice(0, 8),
  });
});

module.exports = router;
