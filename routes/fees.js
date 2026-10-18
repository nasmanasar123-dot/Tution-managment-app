const express = require('express');
const { db } = require('../lib/db');
const { ensureDues, totals, monthStatus, coverage, recordPayment } = require('../lib/fees');
const { paymentDetails, streamReceipt } = require('../lib/receipt');
const { getStudent } = require('./students');
const { today, isDate } = require('../lib/util');

const router = express.Router();
const METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Cheque'];

router.get('/collect', (req, res) => {
  const recent = db.prepare(`
    SELECT DISTINCT s.id, s.name, b.class, b.division FROM payments p
    JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
    WHERE s.active = 1 ORDER BY p.id DESC LIMIT 6
  `).all();
  res.render('fees/search', { title: 'Collect Fee', recent });
});

router.get('/collect/:id', (req, res, next) => {
  const student = getStudent(req.params.id);
  if (!student) return next();
  ensureDues(student.id);
  const t = totals(student.id);
  const unpaid = monthStatus(student.id).filter(m => m.status === 'due' || m.status === 'partial');
  res.render('fees/collect', {
    title: 'Collect Fee', student, t, unpaid, methods: METHODS, today: today(),
    amount: t.pending || student.monthly_fee, error: null,
  });
});

router.post('/collect/:id', (req, res, next) => {
  const student = getStudent(req.params.id);
  if (!student) return next();
  const amount = Math.round(Number(req.body.amount));
  const paid_on = req.body.paid_on;
  const method = METHODS.includes(req.body.method) ? req.body.method : null;
  let error = null;
  if (!(amount > 0) || amount > 10000000) error = 'Enter a valid amount.';
  else if (!isDate(paid_on) || paid_on > today()) error = 'Enter a valid payment date (not in the future).';
  else if (!method) error = 'Choose a payment method.';
  if (error) {
    ensureDues(student.id);
    const unpaid = monthStatus(student.id).filter(m => m.status === 'due' || m.status === 'partial');
    return res.status(400).render('fees/collect', {
      title: 'Collect Fee', student, t: totals(student.id), unpaid, methods: METHODS,
      today: paid_on || today(), amount: req.body.amount, error, method: req.body.method, note: req.body.note,
    });
  }
  const id = recordPayment({ student, amount, paid_on, method, note: (req.body.note || '').trim() });
  res.redirect(`/payments/${id}?new=1`);
});

router.get('/api/coverage', (req, res) => {
  const student = getStudent(req.query.student);
  const amount = Math.round(Number(req.query.amount));
  if (!student || !(amount > 0)) return res.json({ covers: '' });
  ensureDues(student.id);
  res.json({ covers: coverage(student.id, amount, student.monthly_fee) });
});

router.get('/payments/:id', (req, res, next) => {
  const p = paymentDetails(req.params.id);
  if (!p) return next();
  res.render('fees/receipt', { title: `Receipt ${p.receipt_no}`, p, isNew: req.query.new === '1', pending: totals(p.student_id).pending });
});

router.get('/payments/:id/pdf', (req, res, next) => {
  const p = paymentDetails(req.params.id);
  if (!p) return next();
  streamReceipt(p, res);
});

router.post('/payments/:id/void', (req, res, next) => {
  const p = paymentDetails(req.params.id);
  if (!p) return next();
  db.prepare('UPDATE payments SET voided = 1 WHERE id = ?').run(p.id);
  req.flash('success', `Receipt ${p.receipt_no} cancelled. The amount is added back to pending.`);
  res.redirect(`/students/${p.student_id}`);
});

module.exports = router;
