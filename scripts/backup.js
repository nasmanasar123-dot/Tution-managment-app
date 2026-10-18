// Online backup of the SQLite database (safe while the app is running).
// Keeps the last 30 backups. Usage: npm run backup  (schedule daily with cron)
const path = require('path');
const fs = require('fs');
const { db, DATA_DIR } = require('../lib/db');

const dir = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const file = path.join(dir, `tuition-${stamp}.db`);

db.backup(file).then(() => {
  const old = fs.readdirSync(dir).filter(f => /^tuition-.*\.db$/.test(f)).sort().slice(0, -30);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  console.log(`Backup saved: ${file}`);
}).catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
