// Seed: 1 student + 1 exam + sample questions (Neon Postgres)
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const QUESTIONS = [
  {
    text: 'What is the value of 15 + 27?',
    options: ['32', '42', '37', '52'],
    correct: 'B',
    subject: 'Maths',
  },
  {
    text: 'Which planet is known as the Red Planet?',
    options: ['Venus', 'Jupiter', 'Mars', 'Mercury'],
    correct: 'C',
    subject: 'Science',
  },
  {
    text: 'What is H2O commonly known as?',
    options: ['Salt', 'Water', 'Oxygen', 'Hydrogen'],
    correct: 'B',
    subject: 'Science',
  },
  {
    text: 'If a train travels 60 km in 1 hour, how far will it travel in 3 hours at the same speed?',
    options: ['120 km', '240 km', '180 km', '200 km'],
    correct: 'C',
    subject: 'Maths',
  },
  {
    text: 'Which gas do plants absorb from the atmosphere for photosynthesis?',
    options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'],
    correct: 'C',
    subject: 'Science',
  },
];

async function main() {
  // Student (idempotent)
  const s = await pool.query(
    `INSERT INTO students (user_id, full_name, email)
     VALUES ('UID_TEST001', 'Test Student', 'student@test.com')
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, user_id = EXCLUDED.user_id
     RETURNING id, user_id, email`,
  );
  const studentId = s.rows[0].id;

  // Exam (idempotent)
  const e = await pool.query(
    `INSERT INTO exams (exam_code, title, duration_minutes)
     VALUES ('EXAM001', 'Olympiad Exam', 180)
     ON CONFLICT (exam_code) DO UPDATE SET title = EXCLUDED.title
     RETURNING id, exam_code`,
  );
  const examId = e.rows[0].id;

  // Assignment (idempotent, reset to Active for a fresh test run)
  await pool.query(
    `INSERT INTO exam_assignments (student_id, exam_id, status, start_time, end_time)
     VALUES ($1, $2, 'Active', NOW(), NOW() + INTERVAL '3 hours')
     ON CONFLICT (student_id, exam_id)
     DO UPDATE SET status = 'Active', start_time = NOW(), end_time = NOW() + INTERVAL '3 hours', updated_at = NOW()`,
    [studentId, examId],
  );
  // Clear previous test-run data for this assignment
  await pool.query(
    `DELETE FROM exam_answers WHERE assignment_id = (SELECT id FROM exam_assignments WHERE student_id = $1 AND exam_id = $2)`,
    [studentId, examId],
  );
  await pool.query(`DELETE FROM exam_analysis WHERE user_id = 'UID_TEST001' AND exam_code = 'EXAM001'`);

  // Questions (idempotent per question_number)
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    await pool.query(
      `INSERT INTO questions (exam_id, question_number, question_text, option_a_text, option_b_text, option_c_text, option_d_text, correct_option, marks, subject)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 4, $9)
       ON CONFLICT (exam_id, question_number)
       DO UPDATE SET question_text = EXCLUDED.question_text, option_a_text = EXCLUDED.option_a_text,
                     option_b_text = EXCLUDED.option_b_text, option_c_text = EXCLUDED.option_c_text,
                     option_d_text = EXCLUDED.option_d_text, correct_option = EXCLUDED.correct_option`,
      [examId, i + 1, q.text, q.options[0], q.options[1], q.options[2], q.options[3], q.correct, q.subject],
    );
  }

  const count = await pool.query('SELECT COUNT(*)::int AS c FROM questions WHERE exam_id = $1', [examId]);
  console.log('✅ Seed done:');
  console.log('   student email : student@test.com');
  console.log('   user_id       : UID_TEST001');
  console.log('   exam_id       : EXAM001');
  console.log(`   questions     : ${count.rows[0].c}`);
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
