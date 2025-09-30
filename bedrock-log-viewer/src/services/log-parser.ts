import * as zlib from 'zlib';
import { BedrockLogEntry, BedrockMessage, LogRecord } from '../types/bedrock';

export class LogParserService {
    
    /**
     * Decompress gzipped data
     */
    static async decompressGzip(buffer: Buffer): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            zlib.gunzip(buffer, (err, result) => {
                if (err) {
                    reject(new Error(`Failed to decompress gzip data: ${err.message}`));
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Parse log data from decompressed buffer
     */
    static parseLogData(data: Buffer): BedrockLogEntry[] {
        const logs: BedrockLogEntry[] = [];
        const lines = data.toString('utf-8').trim().split('\n');
        
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const logEntry = JSON.parse(line) as BedrockLogEntry;
                    
                    // Validate that this looks like a Bedrock log entry
                    if (this.isValidBedrockLogEntry(logEntry)) {
                        logs.push(logEntry);
                    } else {
                        console.warn('Skipping invalid log entry - missing required fields');
                    }
                } catch (error) {
                    console.warn(`Failed to parse log line: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    // Continue processing other lines
                }
            }
        }
        
        return logs;
    }

    /**
     * Validate that a log entry has the minimum required fields for processing
     */
    static isValidBedrockLogEntry(entry: any): entry is BedrockLogEntry {
        // Check if it has some basic structure that suggests it's a Bedrock log
        return (
            entry &&
            typeof entry === 'object' &&
            // Must have either a timestamp or be parseable as a log entry
            (entry.timestamp || entry.accountId || entry.modelId || entry.input)
        );
    }

    /**
     * Extract a user-friendly summary from Bedrock messages
     */
    static getMessageSummary(messages: BedrockMessage[]): string {
        if (!messages || !Array.isArray(messages)) {
            return 'No messages';
        }
        
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length === 0) {
            return 'No user messages';
        }
        
        const lastUserMessage = userMessages[userMessages.length - 1];
        if (!lastUserMessage.content || !Array.isArray(lastUserMessage.content)) {
            return 'Empty message';
        }
        
        // Find the main text content (skip context/system messages)
        const mainContent = lastUserMessage.content.find(c => 
            c.text && 
            !c.text.includes('[Current Project Context]') && 
            !c.text.includes('[User\'s Current Visual Context]') &&
            c.text.length < 500
        );
        
        if (mainContent && mainContent.text) {
            const summary = mainContent.text.substring(0, 200);
            return summary + (mainContent.text.length > 200 ? '...' : '');
        }
        
        // Fallback to first text content
        const firstText = lastUserMessage.content.find(c => c.text);
        if (firstText && firstText.text) {
            const summary = firstText.text.substring(0, 200);
            return summary + (firstText.text.length > 200 ? '...' : '');
        }
        
        return 'No readable content';
    }

    /**
     * Convert BedrockLogEntry to LogRecord for database storage
     */
    static convertToLogRecord(entry: BedrockLogEntry, s3FileKey: string): LogRecord {
        const messages = entry.input?.inputBodyJson?.messages || [];
        const summary = this.getMessageSummary(messages);
        
        // Ensure we have valid values for required fields
        const timestamp = entry.timestamp || new Date().toISOString();
        const modelId = entry.modelId || 'unknown-model';
        
        // Extract token counts - try multiple sources for accuracy
        const inputTokens = entry.input?.inputTokenCount || 
                           entry.output?.outputBodyJson?.usage?.inputTokens || 0;
        const outputTokens = entry.output?.outputTokenCount || 
                            entry.output?.outputBodyJson?.usage?.outputTokens || 0;
        
        // Bedrock logs don't have HTTP status codes like traditional APIs
        // Instead, we infer success based on whether we got an output
        const statusCode = entry.output?.outputBodyJson ? 200 : 500;
        
        return {
            timestamp,
            model_id: modelId,
            status_code: statusCode,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            request_summary: summary,
            full_log_json: JSON.stringify(entry),
            s3_file_key: s3FileKey
        };
    }

    /**
     * Process log file buffer and return parsed entries with metadata
     */
    static async processLogFile(
        buffer: Buffer, 
        s3Path: string, 
        isGzipped: boolean = false
    ): Promise<{
        logs: BedrockLogEntry[];
        logRecords: LogRecord[];
        metadata: {
            fileSize: number;
            decompressedSize: number;
            logCount: number;
            s3Path: string;
        };
    }> {
        try {
            let data = buffer;
            
            // Decompress if needed
            if (isGzipped) {
                data = await this.decompressGzip(buffer);
            }
            
            // Parse log entries
            const logs = this.parseLogData(data);
            
            // Convert to database records
            const logRecords = logs.map(log => this.convertToLogRecord(log, s3Path));
            
            return {
                logs,
                logRecords,
                metadata: {
                    fileSize: buffer.length,
                    decompressedSize: data.length,
                    logCount: logs.length,
                    s3Path
                }
            };
        } catch (error) {
            throw new Error(`Failed to process log file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Calculate basic statistics from log entries
     */
    static calculateStats(logs: BedrockLogEntry[]) {
        if (logs.length === 0) {
            return {
                totalRequests: 0,
                successRate: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                modelCounts: {},
                statusCounts: {}
            };
        }

        const modelCounts: Record<string, number> = {};
        const statusCounts: Record<string, number> = {};
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        logs.forEach(log => {
            // Count models
            const model = log.modelId || 'Unknown';
            modelCounts[model] = (modelCounts[model] || 0) + 1;

            // Count response statuses - infer from output presence
            const hasOutput = log.output?.outputBodyJson ? '200' : '500';
            statusCounts[hasOutput] = (statusCounts[hasOutput] || 0) + 1;

            // Sum tokens - try multiple sources
            const inputTokens = log.input?.inputTokenCount || 
                               log.output?.outputBodyJson?.usage?.inputTokens || 0;
            const outputTokens = log.output?.outputTokenCount || 
                                log.output?.outputBodyJson?.usage?.outputTokens || 0;
            
            totalInputTokens += inputTokens;
            totalOutputTokens += outputTokens;
        });

        const successRate = ((statusCounts['200'] || 0) / logs.length * 100);
        
        return {
            totalRequests: logs.length,
            successRate,
            totalInputTokens,
            totalOutputTokens,
            modelCounts,
            statusCounts,
            mostUsedModel: Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]
        };
    }
}