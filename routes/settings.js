const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { currentMonth } = require('../lib/util');
const { exams, subjects } = require('../lib/performance');

const router = express.Router();

router.get('/settings', (req, res) => {
  const batches = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) students
    FROM batches b ORDER BY b.class, b.division
  `).all();
  res.render('settings', { title: 'Settings', batches, exams: exams(), subjects: subjects() });
});

router.post('/settings/center', (req, res) => {
  const set = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const key of ['center_name', 'center_address', 'center_phone', 'receipt_prefix']) {
    set.run(String(req.body[key] || '').trim().slice(0, 200), key);
  }
  req.flash('success', 'Center details saved.');
  res.redirect('/settings');
});

// New fees apply to months generated from now on (i.e. next month). With
// effective=this, the current month's charge is also changed; earlier months never change.
router.post('/settings/fees', (req, res) => {
  const batches = db.prepare('SELECT * FROM batches').all();
  const thisMonth = req.body.effective === 'this';
  const m = currentMonth();
  let changed = 0;
  db.transaction(() => {
    for (const b of batches) {
      const fee = Math.round(Number(req.body[`fee_${b.id}`]));
      if (!(fee >= 0) || fee === b.monthly_fee) continue;
      db.prepare('UPDATE batches SET monthly_fee = ? WHERE id = ?').run(fee, b.id);
      if (thisMonth) {
        db.prepare(`UPDATE dues SET amount = ? WHERE month >= ? AND student_id IN (SELECT id FROM students WHERE batch_id = ?)`)
          .run(fee, m, b.id);
      }
      changed++;
    }
  })();
  req.flash('success', changed
    ? `Fees updated for ${changed} class(es), effective ${thisMonth ? 'this month' : 'next month'}.`
    : 'No fee changes.');
  res.redirect('/settings');
});

// Exams and subjects used for marks.
const cleanName = s => String(s || '').trim().slice(0, 60);
const validMax = n => Number.isInteger(n) && n > 0 && n <= 1000;

router.post('/settings/exams', (req, res) => {
  const name = cleanName(req.body.name);
  const max = Number(req.body.max_marks);
  if (!name || !validMax(max)) req.flash('error', 'Enter an exam name and maximum marks (1 to 1000).');
  else {
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM exams').get().n;
    db.prepare('INSERT INTO exams (name, max_marks, sort) VALUES (?, ?, ?)').run(name, max, sort);
    req.flash('success', `Exam "${name}" added.`);
  }
  res.redirect('/settings#exams');
});

router.post('/settings/exams/:id', (req, res) => {
  const name = cleanName(req.body.name);
  const max = Number(req.body.max_marks);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
  if (!exam || !name || !validMax(max)) req.flash('error', 'Enter an exam name and maximum marks (1 to 1000).');
  else {
    const over = db.prepare('SELECT COUNT(*) n FROM marks WHERE exam_id = ? AND marks > ?').get(exam.id, max).n;
    if (over) req.flash('error', `${over} entered mark(s) are above ${max}. Fix those first.`);
    else {
      db.prepare('UPDATE exams SET name = ?, max_marks = ? WHERE id = ?').run(name, max, exam.id);
      req.flash('success', 'Exam updated.');
    }
  }
  res.redirect('/settings#exams');
});

router.post('/settings/exams/:id/delete', (req, res) => {
  db.prepare('DELETE FROM exams WHERE id = ?').run(req.params.id);
  req.flash('success', 'Exam and its marks deleted.');
  res.redirect('/settings#exams');
});

router.post('/settings/subjects', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) req.flash('error', 'Enter a subject name.');
  else {
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM subjects').get().n;
    const info = db.prepare('INSERT OR IGNORE INTO subjects (name, sort) VALUES (?, ?)').run(name, sort);
    req.flash(info.changes ? 'success' : 'error', info.changes ? `Subject "${name}" added.` : 'That subject already exists.');
  }
  res.redirect('/settings#subjects');
});

router.post('/settings/subjects/:id', (req, res) => {
  const name = cleanName(req.body.name);
  try {
    if (name) db.prepare('UPDATE subjects SET name = ? WHERE id = ?').run(name, req.params.id);
    req.flash('success', 'Subject renamed.');
  } catch {
    req.flash('error', 'That subject name already exists.');
  }
  res.redirect('/settings#subjects');
});

router.post('/settings/subjects/:id/delete', (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  req.flash('success', 'Subject and its marks deleted.');
  res.redirect('/settings#subjects');
});

router.post('/settings/pass', (req, res) => {
  const pass = Number(req.body.pass_percent);
  if (!(pass > 0 && pass < 100)) req.flash('error', 'Pass mark must be between 1 and 99.');
  else {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'pass_percent'").run(String(Math.round(pass)));
    req.flash('success', 'Pass mark saved.');
  }
  res.redirect('/settings#exams');
});

router.post('/settings/password', (req, res) => {
  const { current = '', password = '', confirm = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) req.flash('error', 'Current password is wrong.');
  else if (password.length < 8) req.flash('error', 'New password must be at least 8 characters.');
  else if (password !== confirm) req.flash('error', 'New passwords do not match.');
  else {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
    req.flash('success', 'Password changed.');
  }
  res.redirect('/settings');
});

module.exports = router;
