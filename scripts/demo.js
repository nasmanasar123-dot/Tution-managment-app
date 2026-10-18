// Run a local demo copy with 50 sample students, separate from the real database.
// Usage: npm run demo   (then open http://localhost:3001, login demo / demo1234)
//        npm run demo -- --reset   (start over with fresh sample data)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const dir = path.join(__dirname, '..', 'data', 'demo');
const dbPath = path.join(dir, 'tuition-demo.db');
const env = { ...process.env, DB_PATH: dbPath, PORT: process.env.PORT || '3001', NODE_ENV: 'development' };

if (process.argv.includes('--reset')) fs.rmSync(dir, { recursive: true, force: true });

if (!fs.existsSync(dbPath)) {
  const run = args => execFileSync(process.execPath, args, { env, stdio: 'inherit', cwd: path.join(__dirname, '..') });
  run(['scripts/create-admin.js', 'demo', 'demo1234']);
  run(['scripts/seed-demo.js', '--students', '50']);
}

Object.assign(process.env, env);
console.log('Demo login: demo / demo1234');
require('../server');
