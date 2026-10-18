const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { currentMonth } = require('../lib/util');

const router = express.Router();

router.get('/settings', (req, res) => {
  const batches = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) students
    FROM batches b ORDER BY b.class, b.division
  `).all();
  res.render('settings', { title: 'Settings', batches });
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
