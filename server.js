process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const { db, getSettings, DATA_DIR } = require('./lib/db');
const util = require('./lib/util');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const isProd = process.env.NODE_ENV === 'production';

// Session secret: from env, or generated once and kept in the data dir.
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // behind nginx

app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieSession({
  name: 'tc_session',
  secret: sessionSecret(),
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd && process.env.INSECURE_COOKIE !== '1',
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Basic CSRF protection: reject cross-site form posts.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let host = null;
  try { host = new URL(origin).host; } catch {}
  if (host !== req.get('host')) return res.status(403).send('Cross-site request blocked');
  next();
});

app.use((req, res, next) => {
  Object.assign(res.locals, util);
  res.locals.path = req.path;
  res.locals.settings = getSettings();
  res.locals.flash = req.session.flash;
  res.locals.user = req.session.user;
  delete req.session.flash;
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
});

app.use(require('./routes/auth'));

app.use((req, res, next) => {
  if (req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
  res.redirect('/login');
});

app.use(require('./routes/dashboard'));
app.use(require('./routes/students'));
app.use(require('./routes/fees'));
app.use(require('./routes/attendance'));
app.use(require('./routes/reports'));
app.use(require('./routes/performance'));
app.use(require('./routes/settings'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: isProd ? 'Something went wrong.' : err.message });
});

app.listen(PORT, HOST, () => {
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  console.log(`Tuition manager running on http://${HOST}:${PORT}`);
  if (!users) console.log('No admin user yet. Run: npm run create-admin');
});
