// Fill an EMPTY database with demo students, payments, attendance and exam marks.
// Usage: npm run seed                 (about 150 students)
//        npm run seed -- --students 50
// Never run this against the live database: the data is fake.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const { db } = require('../lib/db');
const { ensureDues, totals, recordPayment } = require('../lib/fees');
const { currentMonth, addMonths, today } = require('../lib/util');

if (db.prepare('SELECT COUNT(*) n FROM students').get().n) {
  console.error('Database already has students. Demo data is only added to an empty database.');
  process.exit(1);
}

const argIdx = process.argv.indexOf('--students');
const wanted = argIdx > -1 ? Number(process.argv[argIdx + 1]) : null;

const first = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Meera',
  'Rahul', 'Priya', 'Karthik', 'Fathima', 'Nikhil', 'Sara', 'Adil', 'Lakshmi', 'Joel', 'Nandana', 'Gokul', 'Hiba', 'Varun',
  'Anjali', 'Sidharth', 'Riya', 'Abhinav', 'Gauri', 'Farhan', 'Devika', 'Akash', 'Shreya', 'Manu', 'Nila', 'Tejas'];
const last = ['Nair', 'Menon', 'Sharma', 'Pillai', 'Thomas', 'Khan', 'Iyer', 'Varghese', 'Reddy', 'Das', 'Joseph', 'Kumar'];
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
const gauss = (mean, sd) => mean + sd * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const start = addMonths(currentMonth(), -4);
const batches = db.prepare('SELECT * FROM batches ORDER BY class, division').all();
const insert = db.prepare(`
  INSERT INTO students (name, roll_no, batch_id, parent_name, phone, joined_on, fee_start_month)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Students per batch: spread `wanted` evenly, or 10-15 each.
const counts = batches.map((_, i) => wanted ? Math.floor(wanted / batches.length) + (i < wanted % batches.length ? 1 : 0) : 10 + rand(6));
const usedNames = new Set();
db.transaction(() => {
  batches.forEach((b, bi) => {
    for (let i = 1; i <= counts[bi]; i++) {
      let name;
      do { name = `${pick(first)} ${pick(last)}`; } while (usedNames.has(name));
      usedNames.add(name);
      insert.run(name, String(i), b.id, `${pick(first)} ${name.split(' ')[1]}`,
        '9' + String(100000000 + rand(899999999)), start + '-01', start);
    }
  });
})();
ensureDues();

const students = db.prepare('SELECT s.*, b.monthly_fee FROM students s JOIN batches b ON b.id = s.batch_id').all();
// Hidden "ability" drives marks and (loosely) attendance, so the analysis has realistic patterns.
const ability = new Map(students.map(s => [s.id, clamp(gauss(64, 15), 22, 97)]));

// Payments: most students pay each month, some fall behind.
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
    for (const s of students) {
      const pPresent = 0.7 + 0.28 * (ability.get(s.id) - 22) / 75;
      up.run(s.id, s.batch_id, date, Math.random() < pPresent ? 'P' : 'A');
    }
  }
})();

// Marks for the first two exams (Unit Test 1 and Mid Term).
const subjects = db.prepare('SELECT * FROM subjects').all();
const difficulty = { English: 3, 'Second Language': 5, Maths: -6, Science: -2, 'Social Science': 1 };
const exams = db.prepare('SELECT * FROM exams ORDER BY sort, id LIMIT 2').all();
const mark = db.prepare('INSERT INTO marks (student_id, exam_id, subject_id, marks) VALUES (?, ?, ?, ?)');
db.transaction(() => {
  for (const s of students) {
    const flair = Object.fromEntries(subjects.map(sub => [sub.id, gauss(0, 7)]));
    const trend = gauss(1.5, 5);
    exams.forEach((e, ei) => {
      for (const sub of subjects) {
        if (Math.random() < 0.015) { mark.run(s.id, e.id, sub.id, null); continue; }
        const pct = clamp(ability.get(s.id) + flair[sub.id] + (difficulty[sub.name] || 0) + trend * ei + gauss(0, 5), 5, 100);
        mark.run(s.id, e.id, sub.id, Math.round((pct / 100) * e.max_marks));
      }
    });
  }
})();

console.log(`Demo data added: ${students.length} students, ${db.prepare('SELECT COUNT(*) n FROM payments').get().n} payments, ` +
  `${db.prepare('SELECT COUNT(*) n FROM marks').get().n} marks across ${exams.map(e => e.name).join(' and ')}.`);
