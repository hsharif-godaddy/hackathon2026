import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { LogRecord, ProcessedFile, LogQueryParams, LogQueryResult, TimelineQueryParams, TimelineData, TimelineGroup } from '../types/bedrock';

export class SQLiteDBManager {
    private db: Database.Database;
    private readonly dbPath: string;

    constructor(dbPath: string = './bedrock_logs.db') {
        this.dbPath = dbPath;
        this.db = new Database(dbPath);
    }

    async initialize(): Promise<void> {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Split schema into individual statements and execute them
        const statements = schema.split(';').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
            if (statement.trim()) {
                this.db.exec(statement);
            }
        }
    }

    async insertLogRecord(record: LogRecord): Promise<number> {
        const stmt = this.db.prepare(`
            INSERT INTO logs (timestamp, model_id, status_code, input_tokens, output_tokens, request_summary, full_log_json, s3_file_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
            record.timestamp,
            record.model_id,
            record.status_code,
            record.input_tokens,
            record.output_tokens,
            record.request_summary,
            record.full_log_json,
            record.s3_file_key
        );
        
        return result.lastInsertRowid as number;
    }

    async insertProcessedFile(file: ProcessedFile): Promise<number> {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO processed_files (s3_key, log_count, file_size)
            VALUES (?, ?, ?)
        `);
        
        const result = stmt.run(file.s3_key, file.log_count, file.file_size);
        return result.lastInsertRowid as number;
    }

    async isFileProcessed(s3Key: string): Promise<boolean> {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM processed_files WHERE s3_key = ?');
        const result = stmt.get(s3Key) as { count: number };
        return result.count > 0;
    }

    async queryLogs(params: LogQueryParams): Promise<LogQueryResult> {
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
        const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM logs ${whereClause}`);
        const countResult = countStmt.get(...values) as { total: number };
        const total = countResult.total;
        
        const limit = params.limit || 50;
        const offset = params.offset || 0;
        const page = Math.floor(offset / limit) + 1;
        
        // Get paginated results
        const dataStmt = this.db.prepare(`
            SELECT * FROM logs ${whereClause}
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        `);
        
        const rows = dataStmt.all(...values, limit, offset) as LogRecord[];
        
        return {
            logs: rows,
            total,
            page,
            limit
        };
    }

    async getModelStats(): Promise<any[]> {
        const stmt = this.db.prepare(`
            SELECT 
                model_id,
                COUNT(*) as request_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                AVG(input_tokens) as avg_input_tokens,
                AVG(output_tokens) as avg_output_tokens,
                (SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as success_rate
            FROM logs
            GROUP BY model_id
            ORDER BY request_count DESC
        `);
        
        return stmt.all() as any[];
    }

    async getRecentLogs(limit: number = 10): Promise<LogRecord[]> {
        const stmt = this.db.prepare(`
            SELECT * FROM logs
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        
        return stmt.all(limit) as LogRecord[];
    }

    async getTimelineData(params: TimelineQueryParams): Promise<TimelineData> {
        const { groupBy, limit, search, modelId, startDate, endDate } = params;
        
        // Build WHERE clause for filtering
        const conditions: string[] = [];
        const values: any[] = [];
        
        if (search) {
            conditions.push('request_summary LIKE ?');
            values.push(`%${search}%`);
        }
        
        if (modelId) {
            conditions.push('model_id = ?');
            values.push(modelId);
        }
        
        if (startDate) {
            conditions.push('timestamp >= ?');
            values.push(startDate);
        }
        
        if (endDate) {
            conditions.push('timestamp <= ?');
            values.push(endDate);
        }
        
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        
        // Determine SQL date format based on groupBy
        let dateFormat: string;
        let dateLabel: string;
        
        switch (groupBy) {
            case 'hour':
                dateFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
                dateLabel = "strftime('%Y-%m-%d %H:00', timestamp)";
                break;
            case 'day':
                dateFormat = "strftime('%Y-%m-%d', timestamp)";
                dateLabel = "strftime('%Y-%m-%d', timestamp)";
                break;
            case 'week':
                dateFormat = "strftime('%Y-W%W', timestamp)";
                dateLabel = "strftime('%Y Week %W', timestamp)";
                break;
            default:
                dateFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
                dateLabel = "strftime('%Y-%m-%d %H:00', timestamp)";
        }
        
        // Get grouped timeline data
        const groupStmt = this.db.prepare(`
            SELECT 
                ${dateFormat} as period,
                ${dateLabel} as periodLabel,
                COUNT(*) as requestCount,
                SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) as successCount,
                SUM(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) as errorCount,
                SUM(input_tokens + output_tokens) as totalTokens,
                GROUP_CONCAT(DISTINCT model_id) as models
            FROM logs ${whereClause}
            GROUP BY ${dateFormat}
            ORDER BY period DESC
            LIMIT ?
        `);
        
        const groupResults = groupStmt.all(...values, limit) as any[];
        
        // Get detailed logs for each group
        const groups: TimelineGroup[] = [];
        
        for (const group of groupResults) {
            const logsStmt = this.db.prepare(`
                SELECT * FROM logs 
                WHERE ${dateFormat} = ? ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
                ORDER BY timestamp DESC
                LIMIT 50
            `);
            
            const groupLogs = logsStmt.all(group.period, ...values) as LogRecord[];
            
            groups.push({
                period: group.period,
                periodLabel: group.periodLabel,
                requestCount: group.requestCount,
                successCount: group.successCount,
                errorCount: group.errorCount,
                totalTokens: group.totalTokens || 0,
                models: group.models ? group.models.split(',') : [],
                logs: groupLogs
            });
        }
        
        // Get total count and date range
        const totalStmt = this.db.prepare(`SELECT COUNT(*) as total FROM logs ${whereClause}`);
        const totalResult = totalStmt.get(...values) as { total: number };
        
        const dateRangeStmt = this.db.prepare(`
            SELECT 
                MIN(timestamp) as start,
                MAX(timestamp) as end
            FROM logs ${whereClause}
        `);
        const dateRange = dateRangeStmt.get(...values) as { start: string; end: string };
        
        return {
            groups,
            totalRequests: totalResult.total,
            dateRange: {
                start: dateRange.start || new Date().toISOString(),
                end: dateRange.end || new Date().toISOString()
            }
        };
    }

    async close(): Promise<void> {
        this.db.close();
    }
}