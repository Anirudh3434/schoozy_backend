-- Schoozy exam flow schema (Postgres / Neon)

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  exam_code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Olympiad Exam',
  duration_minutes INT NOT NULL DEFAULT 180,
  created_at TIMESTAMP DEFAULT NOW()
);

-- One row per (student, exam): holds live status + exam window
CREATE TABLE IF NOT EXISTS exam_assignments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ DEFAULT NOW() + INTERVAL '3 hours',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, exam_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_number INT NOT NULL,
  question_text TEXT NOT NULL,
  question_media TEXT,
  option_a_text TEXT NOT NULL,
  option_a_media TEXT,
  option_b_text TEXT NOT NULL,
  option_b_media TEXT,
  option_c_text TEXT NOT NULL,
  option_c_media TEXT,
  option_d_text TEXT NOT NULL,
  option_d_media TEXT,
  correct_option CHAR(1) NOT NULL DEFAULT 'A',
  marks INT NOT NULL DEFAULT 4,
  class INT,
  subject VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(exam_id, question_number)
);

CREATE TABLE IF NOT EXISTS exam_answers (
  id SERIAL PRIMARY KEY,
  assignment_id INT NOT NULL REFERENCES exam_assignments(id) ON DELETE CASCADE,
  question_number INT NOT NULL,
  question_id INT NOT NULL,
  selected_option VARCHAR(5) NOT NULL DEFAULT '',
  is_correct INT NOT NULL DEFAULT 0,
  marks_awarded NUMERIC NOT NULL DEFAULT 0,
  time_taken VARCHAR(20) DEFAULT '0',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(assignment_id, question_number)
);

CREATE TABLE IF NOT EXISTS exam_violations (
  id SERIAL PRIMARY KEY,
  assignment_id INT REFERENCES exam_assignments(id) ON DELETE CASCADE,
  violation_type VARCHAR(50) NOT NULL,
  timestamp_ms BIGINT,
  severity VARCHAR(20),
  description TEXT,
  snapshot_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_analysis (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  exam_code VARCHAR(50) NOT NULL,
  json_response JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
