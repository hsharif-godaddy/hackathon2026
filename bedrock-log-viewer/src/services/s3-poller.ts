import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import * as cron from 'node-cron';
import { SQLiteDBManager } from '../database/sqlite';
import { LogParserService } from './log-parser';
import { LogFileMetadata } from '../types/bedrock';

export interface S3PollerConfig {
    bucketName: string;
    prefix: string;
    pollInterval: string; // Cron expression (e.g., '*/5 * * * *' for every 5 minutes)
    maxFilesPerPoll: number;
    region: string;
}

export class S3PollerService {
    private s3Client: S3Client;
    private dbManager: SQLiteDBManager;
    private config: S3PollerConfig;
    private isRunning: boolean = false;
    private cronJob?: cron.ScheduledTask;

    constructor(config: S3PollerConfig, dbManager: SQLiteDBManager) {
        this.config = config;
        this.dbManager = dbManager;
        this.s3Client = new S3Client({ region: config.region });
    }

    /**
     * Start the polling service
     */
    start(): void {
        if (this.isRunning) {
            console.log('S3 Poller is already running');
            return;
        }

        this.cronJob = cron.schedule(this.config.pollInterval, async () => {
            await this.pollForNewFiles();
        }, {
            scheduled: false
        });

        this.cronJob.start();
        this.isRunning = true;
        
        console.log(`S3 Poller started with interval: ${this.config.pollInterval}`);
        
        // Run initial poll
        this.pollForNewFiles().catch(err => {
            console.error('Error in initial poll:', err);
        });
    }

    /**
     * Stop the polling service
     */
    stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
        }
        this.isRunning = false;
        console.log('S3 Poller stopped');
    }

    /**
     * Manual trigger for polling (useful for testing or immediate sync)
     */
    async triggerPoll(): Promise<{ processed: number; skipped: number; errors: number }> {
        return await this.pollForNewFiles();
    }

    /**
     * Main polling logic
     */
    private async pollForNewFiles(): Promise<{ processed: number; skipped: number; errors: number }> {
        console.log(`Polling S3 bucket: s3://${this.config.bucketName}/${this.config.prefix}`);
        
        let processed = 0;
        let skipped = 0;
        let errors = 0;

        try {
            // List new files from S3
            const files = await this.listS3Files();
            console.log(`Found ${files.length} log files in S3`);

            // Filter to unprocessed files first to avoid wasting time on already processed files
            const unprocessedFiles: LogFileMetadata[] = [];
            let checkedFiles = 0;
            
            for (const file of files) {
                checkedFiles++;
                const isProcessed = await this.dbManager.isFileProcessed(file.key);
                if (!isProcessed) {
                    unprocessedFiles.push(file);
                    // Stop when we have enough unprocessed files to work with
                    if (unprocessedFiles.length >= this.config.maxFilesPerPoll) {
                        break;
                    }
                }
                // Don't check too many files to avoid long delays
                if (checkedFiles >= Math.max(1000, this.config.maxFilesPerPoll * 3)) {
                    break;
                }
            }

            console.log(`Found ${unprocessedFiles.length} unprocessed files (checked ${checkedFiles} total)`);

            // Process unprocessed files in priority order
            for (const file of unprocessedFiles.slice(0, this.config.maxFilesPerPoll)) {
                try {
                    const fileDate = file.date.toISOString().split('T')[0]; // YYYY-MM-DD format
                    console.log(`Processing ${fileDate} file: ${file.fileName}`);
                    
                    // Download and process file
                    const result = await this.processFile(file);
                    if (result) {
                        processed++;
                        console.log(`✅ Processed ${file.fileName}: ${result.logCount} logs inserted`);
                    }
                } catch (error) {
                    errors++;
                    console.error(`❌ Error processing file ${file.fileName}:`, error);
                }
            }

            // Count skipped files (those we didn't process)
            skipped = checkedFiles - unprocessedFiles.length;

            console.log(`Poll complete: ${processed} processed, ${skipped} skipped, ${errors} errors`);
            
        } catch (error) {
            console.error('Error in polling cycle:', error);
            errors++;
        }

        return { processed, skipped, errors };
    }

    /**
     * List log files from S3, prioritizing recent files
     */
    private async listS3Files(): Promise<LogFileMetadata[]> {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0].replace(/-/g, '/'); // Format: 2025/09/26
        const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '/');
        
        // Try to get today's logs first with a specific prefix
        const todayPrefix = `${this.config.prefix}${todayStr}/`;
        const yesterdayPrefix = `${this.config.prefix}${yesterdayStr}/`;
        
        console.log(`Looking for today's logs at: ${todayPrefix}`);
        
        const todayCommand = new ListObjectsV2Command({
            Bucket: this.config.bucketName,
            Prefix: todayPrefix,
            MaxKeys: 500
        });

        const yesterdayCommand = new ListObjectsV2Command({
            Bucket: this.config.bucketName,
            Prefix: yesterdayPrefix,
            MaxKeys: 500
        });

        const generalCommand = new ListObjectsV2Command({
            Bucket: this.config.bucketName,
            Prefix: this.config.prefix,
            MaxKeys: 1000
        });

        // Get today's, yesterday's, and general logs concurrently
        const [todayResponse, yesterdayResponse, generalResponse] = await Promise.all([
            this.s3Client.send(todayCommand).catch(() => ({ Contents: [] })),
            this.s3Client.send(yesterdayCommand).catch(() => ({ Contents: [] })),
            this.s3Client.send(generalCommand).catch(() => ({ Contents: [] }))
        ]);

        // Combine all contents, prioritizing today first
        const allContents = [
            ...(todayResponse.Contents || []),
            ...(yesterdayResponse.Contents || []),
            ...(generalResponse.Contents || []).filter(obj => 
                !obj.Key?.includes(todayStr) && !obj.Key?.includes(yesterdayStr)
            )
        ];
        
        if (!allContents.length) {
            return [];
        }

        console.log(`Found ${todayResponse.Contents?.length || 0} today's logs, ${yesterdayResponse.Contents?.length || 0} yesterday's logs, ${(generalResponse.Contents || []).filter(obj => !obj.Key?.includes(todayStr) && !obj.Key?.includes(yesterdayStr)).length} older logs`);

        // Find the most recent log date to base prioritization on
        const allDates = allContents
            .filter(obj => obj.Key && 
                (obj.Key.endsWith('.json.gz') || obj.Key.endsWith('.json')) &&
                !obj.Key.includes('_input.json') && 
                !obj.Key.includes('_output.json') &&
                obj.Key.includes('BedrockModelInvocationLogs')
            )
            .map(obj => {
                const fileName = obj.Key!.split('/').pop() || '';
                const timestampMatch = fileName.match(/(\d{8}T\d{6})/);
                if (timestampMatch) {
                    const timeStr = timestampMatch[1];
                    const year = timeStr.substring(0, 4);
                    const month = timeStr.substring(4, 6);
                    const day = timeStr.substring(6, 8);
                    const hour = timeStr.substring(9, 11);
                    const minute = timeStr.substring(11, 13);
                    const second = timeStr.substring(13, 15);
                    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
                }
                return obj.LastModified || new Date(0);
            })
            .filter(date => date.getTime() > 0)
            .sort((a, b) => b.getTime() - a.getTime());

        // Use the most recent log date as our reference point, fallback to current time
        const mostRecentLogDate = allDates.length > 0 ? allDates[0] : now;
        const currentHour = new Date(mostRecentLogDate.getFullYear(), mostRecentLogDate.getMonth(), mostRecentLogDate.getDate(), mostRecentLogDate.getHours());
        const lastHour = new Date(currentHour.getTime() - 60 * 60 * 1000);
        const last6Hours = new Date(currentHour.getTime() - 6 * 60 * 60 * 1000);
        const todayDate = new Date(mostRecentLogDate.getFullYear(), mostRecentLogDate.getMonth(), mostRecentLogDate.getDate());
        const yesterdayDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);

        console.log(`Using reference date: ${mostRecentLogDate.toISOString().split('T')[0]} (most recent log date)`);

        const files = allContents
            .filter(obj => obj.Key && 
                (obj.Key.endsWith('.json.gz') || obj.Key.endsWith('.json')) &&
                !obj.Key.includes('_input.json') && // Skip input files
                !obj.Key.includes('_output.json') && // Skip output files
                obj.Key.includes('BedrockModelInvocationLogs') // Only actual log files
            )
            .map(obj => {
                const pathParts = obj.Key!.split('/');
                const fileName = pathParts[pathParts.length - 1];
                
                // Try to extract timestamp from filename
                const timestampMatch = fileName.match(/(\d{8}T\d{6})/);
                let parsedDate = obj.LastModified;
                if (timestampMatch) {
                    const timeStr = timestampMatch[1];
                    const year = timeStr.substring(0, 4);
                    const month = timeStr.substring(4, 6);
                    const day = timeStr.substring(6, 8);
                    const hour = timeStr.substring(9, 11);
                    const minute = timeStr.substring(11, 13);
                    const second = timeStr.substring(13, 15);
                    parsedDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
                }
                
                return {
                    key: obj.Key!,
                    s3Path: `s3://${this.config.bucketName}/${obj.Key}`,
                    fileName: fileName,
                    size: obj.Size || 0,
                    lastModified: obj.LastModified || new Date(),
                    date: parsedDate || obj.LastModified || new Date(),
                    sizeFormatted: this.formatBytes(obj.Size || 0)
                };
            });

        // Prioritize by time buckets: current hour → last hour → last 6 hours → today → yesterday → older
        const currentHourFiles = files.filter(f => f.date >= currentHour);
        const lastHourFiles = files.filter(f => f.date >= lastHour && f.date < currentHour);
        const last6HourFiles = files.filter(f => f.date >= last6Hours && f.date < lastHour);
        const todayFiles = files.filter(f => f.date >= todayDate && f.date < last6Hours);
        const yesterdayFiles = files.filter(f => f.date >= yesterdayDate && f.date < todayDate);
        const olderFiles = files.filter(f => f.date < yesterdayDate);

        // Sort each group by date descending, then concatenate with priority
        const sortedFiles = [
            ...currentHourFiles.sort((a, b) => b.date.getTime() - a.date.getTime()),
            ...lastHourFiles.sort((a, b) => b.date.getTime() - a.date.getTime()),
            ...last6HourFiles.sort((a, b) => b.date.getTime() - a.date.getTime()),
            ...todayFiles.sort((a, b) => b.date.getTime() - a.date.getTime()),
            ...yesterdayFiles.sort((a, b) => b.date.getTime() - a.date.getTime()),
            ...olderFiles.sort((a, b) => b.date.getTime() - a.date.getTime())
        ];

        console.log(`Found files: ${currentHourFiles.length} current hour, ${lastHourFiles.length} last hour, ${last6HourFiles.length} last 6h, ${todayFiles.length} today, ${yesterdayFiles.length} yesterday, ${olderFiles.length} older`);
        
        return sortedFiles;
    }

    /**
     * Process a single file
     */
    private async processFile(file: LogFileMetadata): Promise<{ logCount: number } | null> {
        try {
            // Download file from S3
            const command = new GetObjectCommand({
                Bucket: this.config.bucketName,
                Key: file.key
            });

            const response = await this.s3Client.send(command);
            
            if (!response.Body) {
                throw new Error('Empty response body from S3');
            }

            // Convert stream to buffer
            const chunks: Buffer[] = [];
            for await (const chunk of response.Body as any) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            // Process the log file
            const isGzipped = file.key.endsWith('.gz') || file.key.endsWith('.gzip');
            const result = await LogParserService.processLogFile(buffer, file.key, isGzipped);

            // Insert logs into database (skip invalid records)
            let insertedCount = 0;
            for (const record of result.logRecords) {
                try {
                    await this.dbManager.insertLogRecord(record);
                    insertedCount++;
                } catch (error) {
                    console.warn(`Failed to insert log record: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    // Continue with other records
                }
            }

            // Mark file as processed
            await this.dbManager.insertProcessedFile({
                s3_key: file.key,
                log_count: insertedCount,
                file_size: file.size,
                processed_at: new Date().toISOString()
            });

            return { logCount: insertedCount };

        } catch (error) {
            console.error(`Error processing file ${file.key}:`, error);
            throw error;
        }
    }

    /**
     * Format bytes to human readable format
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Get service status
     */
    getStatus(): { running: boolean; config: S3PollerConfig } {
        return {
            running: this.isRunning,
            config: this.config
        };
    }
}