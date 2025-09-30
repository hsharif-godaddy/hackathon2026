-- Database schema for Bedrock log viewer (SQLite)

-- Table to store processed log entries
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    request_summary TEXT NOT NULL,
    full_log_json TEXT NOT NULL,
    s3_file_key TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Table to track which S3 files have been processed
CREATE TABLE IF NOT EXISTS processed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    s3_key TEXT UNIQUE NOT NULL,
    processed_at TEXT DEFAULT (datetime('now')),
    log_count INTEGER NOT NULL,
    file_size INTEGER NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_model_id ON logs(model_id);
CREATE INDEX IF NOT EXISTS idx_logs_status_code ON logs(status_code);
CREATE INDEX IF NOT EXISTS idx_logs_s3_file_key ON logs(s3_file_key);

-- Index for processed files
CREATE INDEX IF NOT EXISTS idx_processed_files_s3_key ON processed_files(s3_key);
CREATE INDEX IF NOT EXISTS idx_processed_files_processed_at ON processed_files(processed_at);