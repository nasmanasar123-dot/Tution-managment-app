// Fill an EMPTY database with demo students, payments and attendance for trying the app.
// Usage: npm run seed
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const { db } = require('../lib/db');
const { ensureDues, totals, recordPayment } = require('../lib/fees');
const { currentMonth, addMonths, today } = require('../lib/util');

if (db.prepare('SELECT COUNT(*) n FROM students').get().n) {
  console.error('Database already has students. Demo data is only added to an empty database.');
  process.exit(1);
}

const first = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Meera',
  'Rahul', 'Priya', 'Karthik', 'Fathima', 'Nikhil', 'Sara', 'Adil', 'Lakshmi', 'Joel', 'Nandana', 'Gokul', 'Hiba', 'Varun'];
const last = ['Nair', 'Menon', 'Sharma', 'Pillai', 'Thomas', 'Khan', 'Iyer', 'Varghese', 'Reddy', 'Das', 'Joseph', 'Kumar'];
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];

const start = addMonths(currentMonth(), -4);
const batches = db.prepare('SELECT b.*, b.monthly_fee FROM batches b').all();
const insert = db.prepare(`
  INSERT INTO students (name, roll_no, batch_id, parent_name, phone, joined_on, fee_start_month)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const b of batches) {
    const n = 10 + rand(6);
    for (let i = 1; i <= n; i++) {
      const surname = pick(last);
      insert.run(`${pick(first)} ${surname}`, String(i), b.id, `${pick(first)} ${surname}`,
        '9' + String(100000000 + rand(899999999)), start + '-01', start);
    }
  }
})();
ensureDues();

// Payments: most students pay each month, some fall behind.
const students = db.prepare('SELECT s.*, b.monthly_fee FROM students s JOIN batches b ON b.id = s.batch_id').all();
for (const s of students) {
  const behind = Math.random() < 0.25 ? 1 + rand(2) : 0;
  for (let m = start; m <= addMonths(currentMonth(), -behind); m = addMonths(m, 1)) {
    if (totals(s.id).pending <= 0) break;
    const day = String(1 + rand(m === currentMonth() ? Number(today().slice(8)) : 25)).padStart(2, '0');
    recordPayment({ student: s, amount: s.monthly_fee, paid_on: `${m}-${day}`, method: pick(['Cash', 'Cash', 'UPI', 'UPI', 'Bank Transfer']) });
  }
}

// Attendance: Mon-Sat for the last 30 days.
const up = db.prepare('INSERT OR IGNORE INTO attendance (student_id, batch_id, date, status) VALUES (?, ?, ?, ?)');
db.transaction(() => {
  for (let i = 30; i >= 1; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue;
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const s of students) up.run(s.id, s.batch_id, date, Math.random() < 0.9 ? 'P' : 'A');
  }
})();

console.log(`Demo data added: ${students.length} students, ${db.prepare('SELECT COUNT(*) n FROM payments').get().n} payments.`);
