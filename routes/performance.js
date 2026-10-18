const express = require('express');
const { db } = require('../lib/db');
const perf = require('../lib/performance');
const { sendCsv } = require('../lib/csv');

const router = express.Router();

router.get('/performance', (req, res) => {
  const exams = perf.exams();
  const withMarks = exams.filter(e => e.students > 0);
  // Default to the latest exam with marks; "all" = combined across exams.
  let examId = req.query.exam === 'all' ? null : Number(req.query.exam) || null;
  if (!req.query.exam && withMarks.length) examId = withMarks[withMarks.length - 1].id;
  const exam = exams.find(e => e.id === examId) || null;
  const classNo = [8, 9, 10].includes(Number(req.query.class)) ? Number(req.query.class) : null;
  const a = perf.analysis({ examId, classNo });

  if (req.query.format === 'csv') {
    return sendCsv(res, `results-${exam ? exam.name.replace(/\W+/g, '-') : 'all-exams'}${classNo ? '-class-' + classNo : ''}`,
      ['School rank', 'Class rank', 'Student', 'Class', 'Roll No', ...a.subjects.map(s => s.name + ' %'), 'Total %', 'Grade', 'Result'],
      a.all.map(s => [s.rank, s.classRank, s.name, `${s.class}-${s.division}`, s.roll_no,
        ...a.subjects.map(sub => (s.subjects[sub.id] ? s.subjects[sub.id].pct : '')),
        s.pct, s.grade, s.passed ? 'Pass' : 'Needs improvement']));
  }

  res.render('performance/index', { title: 'Results', exams, exam, examId, classNo, a, hasAny: withMarks.length > 0 });
});

router.get('/performance/marks', (req, res) => {
  const exams = perf.exams();
  const subjects = perf.subjects();
  const batches = db.prepare('SELECT * FROM batches ORDER BY class, division').all();
  const exam = exams.find(e => e.id === Number(req.query.exam));
  const subject = subjects.find(s => s.id === Number(req.query.subject));
  const batch = batches.find(b => b.id === Number(req.query.batch));

  let students = [];
  if (exam && subject && batch) {
    students = db.prepare(`
      SELECT s.id, s.name, s.roll_no, m.marks, (m.student_id IS NOT NULL) entered
      FROM students s LEFT JOIN marks m ON m.student_id = s.id AND m.exam_id = ? AND m.subject_id = ?
      WHERE s.batch_id = ? AND s.active = 1
      ORDER BY CAST(s.roll_no AS INTEGER), s.roll_no, s.name
    `).all(exam.id, subject.id, batch.id);
  }

  // Which subjects of this exam + batch already have marks, for the progress chips.
  const done = exam && batch ? new Set(db.prepare(`
    SELECT DISTINCT m.subject_id FROM marks m JOIN students s ON s.id = m.student_id
    WHERE m.exam_id = ? AND s.batch_id = ?
  `).all(exam.id, batch.id).map(r => r.subject_id)) : new Set();

  res.render('performance/marks', { title: 'Enter Marks', exams, subjects, batches, exam, subject, batch, students, done });
});

router.post('/performance/marks', (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(Number(req.body.exam_id));
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(Number(req.body.subject_id));
  const batchId = Number(req.body.batch_id);
  if (!exam || !subject) {
    req.flash('error', 'Choose an exam and subject.');
    return res.redirect('/performance/marks');
  }
  const valid = new Set(db.prepare('SELECT id FROM students WHERE batch_id = ?').all(batchId).map(r => r.id));
  const upsert = db.prepare(`
    INSERT INTO marks (student_id, exam_id, subject_id, marks) VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, exam_id, subject_id) DO UPDATE SET marks = excluded.marks
  `);
  const clear = db.prepare('DELETE FROM marks WHERE student_id = ? AND exam_id = ? AND subject_id = ?');
  const absent = new Set([].concat(req.body.absent || []).map(Number));
  const errors = [];
  let saved = 0;

  db.transaction(() => {
    for (const id of [].concat(req.body.student || []).map(Number)) {
      if (!valid.has(id)) continue;
      const raw = String(req.body[`m_${id}`] ?? '').trim();
      if (absent.has(id)) { upsert.run(id, exam.id, subject.id, null); saved++; continue; }
      if (raw === '') { clear.run(id, exam.id, subject.id); continue; }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > exam.max_marks) { errors.push(raw); continue; }
      upsert.run(id, exam.id, subject.id, Math.round(v * 2) / 2);
      saved++;
    }
  })();

  if (errors.length) req.flash('error', `Saved ${saved}. Skipped invalid marks (${errors.join(', ')}); marks must be 0 to ${exam.max_marks}.`);
  else req.flash('success', `${subject.name} marks saved for ${saved} student${saved === 1 ? '' : 's'}.`);
  res.redirect(`/performance/marks?exam=${exam.id}&batch=${batchId}&subject=${subject.id}`);
});

module.exports = router;
