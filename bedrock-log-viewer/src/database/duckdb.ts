// @ts-nocheck
import * as duckdb from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';
import { LogRecord, ProcessedFile, LogQueryParams, LogQueryResult } from '../types/bedrock';

export class DuckDBManager {
    private db: duckdb.Database;
    private readonly dbPath: string;

    constructor(dbPath: string = './bedrock_logs.duckdb') {
        this.dbPath = dbPath;
        this.db = new duckdb.Database(dbPath);
    }

    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            const schemaPath = path.join(__dirname, 'schema.sql');
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            this.db.exec(schema, (err) => {
                if (err) {
                    reject(new Error(`Failed to initialize database: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });
    }

    async insertLogRecord(record: LogRecord): Promise<number> {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO logs (timestamp, model_id, status_code, input_tokens, output_tokens, request_summary, full_log_json, s3_file_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            this.db.run(sql, 
                record.timestamp,
                record.model_id,
                record.status_code,
                record.input_tokens,
                record.output_tokens,
                record.request_summary,
                record.full_log_json,
                record.s3_file_key,
                function(this: any, err: any) {
                    if (err) {
                        reject(new Error(`Failed to insert log record: ${err.message}`));
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    async insertProcessedFile(file: ProcessedFile): Promise<number> {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT OR REPLACE INTO processed_files (s3_key, log_count, file_size)
                VALUES (?, ?, ?)
            `;
            
            this.db.run(sql, file.s3_key, file.log_count, file.file_size, function(this: any, err: any) {
                if (err) {
                    reject(new Error(`Failed to insert processed file: ${err.message}`));
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    async isFileProcessed(s3Key: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT COUNT(*) as count FROM processed_files WHERE s3_key = ?';
            
            this.db.get(sql, s3Key, (err: any, row: any) => {
                if (err) {
                    reject(new Error(`Failed to check processed file: ${err.message}`));
                } else {
                    resolve(row && row.count > 0);
                }
            });
        });
    }

    async queryLogs(params: LogQueryParams): Promise<LogQueryResult> {
        return new Promise((resolve, reject) => {
            const conditions: string[] = [];
            const values: any[] = [];
            
            // Build WHERE clause
            if (params.search) {
                conditions.push('request_summary LIKE ?');
                values.push(`%${params.search}%`);
            }
            
            if (params.model_id) {
                conditions.push('model_id = ?');
                values.push(params.model_id);
            }
            
            if (params.status_code) {
                conditions.push('status_code = ?');
                values.push(params.status_code);
            }
            
            if (params.start_date) {
                conditions.push('timestamp >= ?');
                values.push(params.start_date);
            }
            
            if (params.end_date) {
                conditions.push('timestamp <= ?');
                values.push(params.end_date);
            }
            
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            
            // Get total count
            const countSql = `SELECT COUNT(*) as total FROM logs ${whereClause}`;
            
            this.db.get(countSql, ...values, (err: any, countRow: any) => {
                if (err) {
                    reject(new Error(`Failed to count logs: ${err.message}`));
                    return;
                }
                
                const total = countRow ? countRow.total : 0;
                const limit = params.limit || 50;
                const offset = params.offset || 0;
                const page = Math.floor(offset / limit) + 1;
                
                // Get paginated results
                const dataSql = `
                    SELECT * FROM logs ${whereClause}
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                `;
                
                this.db.all(dataSql, ...values, limit, offset, (err: any, rows: any[]) => {
                    if (err) {
                        reject(new Error(`Failed to query logs: ${err.message}`));
                    } else {
                        resolve({
                            logs: (rows || []) as LogRecord[],
                            total,
                            page,
                            limit
                        });
                    }
                });
            });
        });
    }

    async getModelStats(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    model_id,
                    COUNT(*) as request_count,
                    SUM(input_tokens) as total_input_tokens,
                    SUM(output_tokens) as total_output_tokens,
                    AVG(input_tokens) as avg_input_tokens,
                    AVG(output_tokens) as avg_output_tokens,
                    SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
                FROM logs
                GROUP BY model_id
                ORDER BY request_count DESC
            `;
            
            this.db.all(sql, [], (err: any, rows: any[]) => {
                if (err) {
                    reject(new Error(`Failed to get model stats: ${err.message}`));
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getRecentLogs(limit: number = 10): Promise<LogRecord[]> {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM logs
                ORDER BY timestamp DESC
                LIMIT ?
            `;
            
            this.db.all(sql, [limit], (err: any, rows: any[]) => {
                if (err) {
                    reject(new Error(`Failed to get recent logs: ${err.message}`));
                } else {
                    resolve(rows as LogRecord[]);
                }
            });
        });
    }

    async close(): Promise<void> {
        return new Promise((resolve) => {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                }
                resolve();
            });
        });
    }
}