const express = require('express');
const { db } = require('../lib/db');
const { today, isDate } = require('../lib/util');

const router = express.Router();

router.get('/attendance', (req, res) => {
  const date = isDate(req.query.date) && req.query.date <= today() ? req.query.date : today();
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(Number(req.query.batch));

  if (!batch) {
    const batches = db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) total,
        (SELECT COUNT(*) FROM attendance a WHERE a.batch_id = b.id AND a.date = ? AND a.status = 'P') present,
        (SELECT COUNT(*) FROM attendance a WHERE a.batch_id = b.id AND a.date = ?) marked
      FROM batches b ORDER BY b.class, b.division
    `).all(date, date);
    return res.render('attendance/index', { title: 'Attendance', batches, date });
  }

  const students = db.prepare(`
    SELECT s.id, s.name, s.roll_no, a.status
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.batch_id = ? AND (s.active = 1 OR a.status IS NOT NULL)
    ORDER BY CAST(s.roll_no AS INTEGER), s.roll_no, s.name
  `).all(date, batch.id);
  const marked = students.some(s => s.status);
  res.render('attendance/mark', { title: 'Mark Attendance', batch, students, date, marked });
});

router.post('/attendance', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(Number(req.body.batch_id));
  const date = req.body.date;
  if (!batch || !isDate(date) || date > today()) {
    req.flash('error', 'Invalid class or date.');
    return res.redirect('/attendance');
  }
  const present = new Set([].concat(req.body.present || []).map(Number));
  const ids = [].concat(req.body.student || []).map(Number);
  const valid = new Set(db.prepare('SELECT id FROM students WHERE batch_id = ?').all(batch.id).map(r => r.id));
  const upsert = db.prepare(`
    INSERT INTO attendance (student_id, batch_id, date, status) VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, date) DO UPDATE SET status = excluded.status, batch_id = excluded.batch_id
  `);
  let p = 0, a = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (!valid.has(id)) continue;
      const status = present.has(id) ? 'P' : 'A';
      status === 'P' ? p++ : a++;
      upsert.run(id, batch.id, date, status);
    }
  })();
  req.flash('success', `Attendance saved for Class ${batch.class}-${batch.division}: ${p} present, ${a} absent.`);
  res.redirect(`/attendance?date=${date}`);
});

module.exports = router;
