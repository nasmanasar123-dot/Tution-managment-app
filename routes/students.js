const express = require('express');
const { db } = require('../lib/db');
const { ensureDues, totals, monthStatus, pendingList } = require('../lib/fees');
const { today, currentMonth, addMonths, isDate, isMonth } = require('../lib/util');

const router = express.Router();

const batches = () => db.prepare('SELECT * FROM batches ORDER BY class, division').all();

function getStudent(id) {
  return db.prepare(`
    SELECT s.*, b.class, b.division, b.monthly_fee
    FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?
  `).get(id);
}

function readForm(body) {
  const s = {
    name: (body.name || '').trim(),
    roll_no: (body.roll_no || '').trim() || null,
    batch_id: Number(body.batch_id),
    parent_name: (body.parent_name || '').trim() || null,
    phone: (body.phone || '').replace(/[^\d+]/g, '') || null,
    joined_on: body.joined_on,
    fee_start_month: body.fee_start_month,
    notes: (body.notes || '').trim() || null,
  };
  const errors = [];
  if (!s.name) errors.push('Name is required.');
  if (!db.prepare('SELECT 1 FROM batches WHERE id = ?').get(s.batch_id)) errors.push('Choose a class.');
  if (!isDate(s.joined_on)) errors.push('Joining date is invalid.');
  if (!isMonth(s.fee_start_month)) errors.push('Fee start month is invalid.');
  return { s, errors };
}

router.get('/students', (req, res) => {
  ensureDues();
  const batchId = Number(req.query.batch) || null;
  const q = (req.query.q || '').trim().toLowerCase();
  const showInactive = req.query.status === 'inactive';

  let list;
  if (showInactive) {
    list = db.prepare(`
      SELECT s.*, b.class, b.division, 0 pending FROM students s JOIN batches b ON b.id = s.batch_id
      WHERE s.active = 0 ${batchId ? 'AND s.batch_id = ?' : ''} ORDER BY b.class, b.division, s.name
    `).all(...(batchId ? [batchId] : []));
  } else {
    list = pendingList({ batchId });
  }
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || (s.phone || '').includes(q) || (s.roll_no || '').toLowerCase() === q);
  res.render('students/index', { title: 'Students', list, batches: batches(), batchId, q: req.query.q || '', showInactive });
});

router.get('/students/new', (req, res) => {
  const t = today();
  res.render('students/form', {
    title: 'Add Student', errors: [], batches: batches(),
    s: { batch_id: Number(req.query.batch) || '', joined_on: t, fee_start_month: t.slice(0, 7) },
  });
});

router.post('/students', (req, res) => {
  const { s, errors } = readForm(req.body);
  if (errors.length) return res.status(400).render('students/form', { title: 'Add Student', errors, s, batches: batches() });
  const info = db.prepare(`
    INSERT INTO students (name, roll_no, batch_id, parent_name, phone, joined_on, fee_start_month, notes)
    VALUES (@name, @roll_no, @batch_id, @parent_name, @phone, @joined_on, @fee_start_month, @notes)
  `).run(s);
  req.flash('success', `${s.name} added.`);
  if (req.body.again) return res.redirect(`/students/new?batch=${s.batch_id}`);
  res.redirect(`/students/${info.lastInsertRowid}`);
});

router.get('/students/:id', (req, res, next) => {
  const student = getStudent(req.params.id);
  if (!student) return next();
  ensureDues(student.id);
  const months = monthStatus(student.id).reverse();
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC').all(student.id);

  const m = currentMonth();
  const att = db.prepare(`
    SELECT
      SUM(status = 'P') present, COUNT(*) total,
      SUM(status = 'P' AND substr(date, 1, 7) = ?) mPresent, SUM(substr(date, 1, 7) = ?) mTotal
    FROM attendance WHERE student_id = ?
  `).get(m, m, student.id);
  const absences = db.prepare(`SELECT date FROM attendance WHERE student_id = ? AND status = 'A' ORDER BY date DESC LIMIT 10`).all(student.id);

  res.render('students/show', { title: student.name, student, t: totals(student.id), months, payments, att, absences });
});

router.get('/students/:id/edit', (req, res, next) => {
  const s = getStudent(req.params.id);
  if (!s) return next();
  res.render('students/form', { title: 'Edit Student', errors: [], s, batches: batches() });
});

router.post('/students/:id', (req, res, next) => {
  const existing = getStudent(req.params.id);
  if (!existing) return next();
  const { s, errors } = readForm(req.body);
  s.id = existing.id;
  if (errors.length) return res.status(400).render('students/form', { title: 'Edit Student', errors, s, batches: batches() });
  db.transaction(() => {
    db.prepare(`
      UPDATE students SET name=@name, roll_no=@roll_no, batch_id=@batch_id, parent_name=@parent_name,
        phone=@phone, joined_on=@joined_on, fee_start_month=@fee_start_month, notes=@notes WHERE id=@id
    `).run(s);
    // Fee start moved later: drop months that are no longer charged.
    db.prepare('DELETE FROM dues WHERE student_id = ? AND month < ?').run(s.id, s.fee_start_month);
  })();
  req.flash('success', 'Student updated.');
  res.redirect(`/students/${s.id}`);
});

router.post('/students/:id/active', (req, res, next) => {
  const s = getStudent(req.params.id);
  if (!s) return next();
  if (s.active) {
    db.prepare('UPDATE students SET active = 0 WHERE id = ?').run(s.id);
    req.flash('success', `${s.name} marked as left. No new fees will be charged.`);
  } else {
    // Months while the student was away are recorded as waived, not charged.
    db.transaction(() => {
      const last = db.prepare('SELECT MAX(month) m FROM dues WHERE student_id = ?').get(s.id).m;
      const now = currentMonth();
      if (last) {
        const ins = db.prepare('INSERT OR IGNORE INTO dues (student_id, month, amount, waived) VALUES (?, ?, ?, 1)');
        for (let m = addMonths(last, 1); m < now; m = addMonths(m, 1)) ins.run(s.id, m, s.monthly_fee);
      }
      db.prepare('UPDATE students SET active = 1 WHERE id = ?').run(s.id);
    })();
    req.flash('success', `${s.name} is active again. Fees resume from this month.`);
  }
  res.redirect(`/students/${s.id}`);
});

router.post('/students/:id/dues/:month/waive', (req, res, next) => {
  const due = db.prepare('SELECT * FROM dues WHERE student_id = ? AND month = ?').get(req.params.id, req.params.month);
  if (!due) return next();
  db.prepare('UPDATE dues SET waived = 1 - waived WHERE id = ?').run(due.id);
  req.flash('success', due.waived ? 'Fee for the month restored.' : 'Fee for the month waived.');
  res.redirect(`/students/${req.params.id}#months`);
});

router.post('/students/:id/delete', (req, res, next) => {
  const s = getStudent(req.params.id);
  if (!s) return next();
  const paid = db.prepare('SELECT COUNT(*) n FROM payments WHERE student_id = ?').get(s.id).n;
  if (paid) {
    req.flash('error', 'This student has payment records, so they cannot be deleted. Mark them as left instead.');
    return res.redirect(`/students/${s.id}`);
  }
  db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
  req.flash('success', `${s.name} deleted.`);
  res.redirect('/students');
});

// Search used by the quick collect screen.
router.get('/api/students', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = db.prepare(`
    SELECT s.id, s.name, s.roll_no, s.phone, b.class, b.division
    FROM students s JOIN batches b ON b.id = s.batch_id
    WHERE s.active = 1 AND (s.name LIKE ? OR s.phone LIKE ? OR s.roll_no LIKE ?)
    ORDER BY s.name LIMIT 20
  `).all(q, q, q);
  res.json(rows);
});

module.exports = Object.assign(router, { getStudent });
