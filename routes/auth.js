const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');

const router = express.Router();

// Simple in-memory brute force guard: 10 failed attempts per IP per 15 minutes.
const failures = new Map();
const WINDOW = 15 * 60 * 1000;

function tooMany(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW) return false;
  return f.count >= 10;
}

function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW) failures.set(ip, { first: Date.now(), count: 1 });
  else f.count++;
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', (req, res) => {
  if (tooMany(req.ip)) {
    return res.status(429).render('login', { title: 'Login', error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const { username = '', password = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailure(req.ip);
    return res.status(401).render('login', { title: 'Login', error: 'Wrong username or password.' });
  }
  failures.delete(req.ip);
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
