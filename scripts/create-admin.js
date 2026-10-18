// Create or reset an admin login.
// Usage: npm run create-admin               (prompts)
//        node scripts/create-admin.js <username> <password>
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');

async function ask(rl, q) {
  return new Promise(resolve => rl.question(q, resolve));
}

(async () => {
  let [username, password] = process.argv.slice(2);
  if (!username || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    username = username || await ask(rl, 'Username: ');
    password = await ask(rl, 'Password (min 8 chars): ');
    rl.close();
  }
  username = String(username).trim().toLowerCase();
  if (!username || String(password).length < 8) {
    console.error('Username is required and password must be at least 8 characters.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash) VALUES (?, ?)
    ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash
  `).run(username, hash);
  console.log(`Admin "${username}" is ready. You can log in now.`);
})();
