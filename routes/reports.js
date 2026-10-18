const express = require('express');
const { db } = require('../lib/db');
const { ensureDues, pendingList } = require('../lib/fees');
const { today, currentMonth, isDate, isMonth, lastDayOfMonth, batchName } = require('../lib/util');
const { sendCsv } = require('../lib/csv');

const router = express.Router();

router.get('/reports', (req, res) => {
  const type = ['collections', 'pending', 'attendance'].includes(req.query.type) ? req.query.type : 'collections';
  const batches = db.prepare('SELECT * FROM batches ORDER BY class, division').all();
  const batchId = Number(req.query.batch) || null;
  const csv = req.query.format === 'csv';
  const view = { title: 'Reports', type, batches, batchId, q: req.query };

  if (type === 'collections') {
    const from = isDate(req.query.from) ? req.query.from : currentMonth() + '-01';
    const to = isDate(req.query.to) ? req.query.to : today();
    const method = req.query.method || '';
    const where = ['p.voided = 0', 'p.paid_on BETWEEN ? AND ?'];
    const params = [from, to];
    if (batchId) { where.push('p.batch_id = ?'); params.push(batchId); }
    if (method) { where.push('p.method = ?'); params.push(method); }
    const rows = db.prepare(`
      SELECT p.*, s.name, s.roll_no, b.class, b.division
      FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = p.batch_id
      WHERE ${where.join(' AND ')} ORDER BY p.paid_on DESC, p.id DESC
    `).all(...params);
    if (csv) {
      return sendCsv(res, `collections-${from}-to-${to}`,
        ['Receipt', 'Date', 'Student', 'Class', 'Roll No', 'Amount', 'Method', 'Covers', 'Note'],
        rows.map(r => [r.receipt_no, r.paid_on, r.name, batchName(r), r.roll_no, r.amount, r.method, r.covers, r.note]));
    }
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const byMethod = {};
    for (const r of rows) byMethod[r.method] = (byMethod[r.method] || 0) + r.amount;
    return res.render('reports', { ...view, rows, total, byMethod, from, to, method });
  }

  if (type === 'pending') {
    ensureDues();
    const rows = pendingList({ batchId }).filter(r => r.pending > 0);
    if (csv) {
      return sendCsv(res, `pending-fees-${today()}`, ['Student', 'Class', 'Roll No', 'Parent', 'Phone', 'Pending'],
        rows.map(r => [r.name, batchName(r), r.roll_no, r.parent_name, r.phone, r.pending]));
    }
    return res.render('reports', { ...view, rows, total: rows.reduce((a, r) => a + r.pending, 0) });
  }

  // attendance
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  const where = ['s.active = 1'];
  const params = [month + '-01', lastDayOfMonth(month)];
  if (batchId) { where.push('s.batch_id = ?'); params.push(batchId); }
  const rows = db.prepare(`
    SELECT s.id, s.name, s.roll_no, b.class, b.division,
      COUNT(a.status) total, COALESCE(SUM(a.status = 'P'), 0) present
    FROM students s JOIN batches b ON b.id = s.batch_id
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
    WHERE ${where.join(' AND ')}
    GROUP BY s.id ORDER BY b.class, b.division, s.name
  `).all(...params).map(r => ({ ...r, pct: r.total ? Math.round((r.present / r.total) * 100) : null }));
  if (csv) {
    return sendCsv(res, `attendance-${month}`, ['Student', 'Class', 'Roll No', 'Present', 'Classes held', 'Percent'],
      rows.map(r => [r.name, batchName(r), r.roll_no, r.present, r.total, r.pct == null ? '' : r.pct]));
  }
  res.render('reports', { ...view, rows, month });
});

module.exports = router;
