import { Router, Request, Response } from 'express';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQLiteDBManager } from '../database/sqlite';
import { LogParserService } from '../services/log-parser';
import { S3PollerService } from '../services/s3-poller';
import { S3PathRequest, S3PrefixRequest } from '../types/bedrock';

interface ParseS3PathResult {
    bucket: string;
    key: string;
}

export function createSyncRouter(
    s3Client: S3Client, 
    dbManager: SQLiteDBManager, 
    s3Poller?: S3PollerService
): Router {
    const router = Router();

    /**
     * Helper function to parse S3 path
     */
    function parseS3Path(s3Path: string): ParseS3PathResult {
        const match = s3Path.match(/^s3:\/\/([^\/]+)\/(.+)$/);
        if (!match) {
            throw new Error('Invalid S3 path format. Expected: s3://bucket-name/path/to/file');
        }
        return {
            bucket: match[1],
            key: match[2]
        };
    }

    /**
     * Helper function to format bytes
     */
    function formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * POST /api/sync/download-log - Download and process a single log file (legacy endpoint)
     */
    router.post('/download-log', async (req: Request, res: Response) => {
        try {
            const { s3Path }: S3PathRequest = req.body;
            
            if (!s3Path) {
                return res.status(400).json({ error: 'S3 path is required' });
            }

            console.log('Downloading log from:', s3Path);
            
            const { bucket, key } = parseS3Path(s3Path);
            
            // Download file from S3
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key
            });
            
            const response = await s3Client.send(command);
            
            if (!response.Body) {
                throw new Error('Empty response body from S3');
            }
            
            // Convert stream to buffer
            const chunks: Buffer[] = [];
            for await (const chunk of response.Body as any) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            
            console.log('Downloaded file size:', buffer.length, 'bytes');
            
            // Check if file is gzipped
            const isGzipped = key.endsWith('.gz') || key.endsWith('.gzip');
            
            // Process the log file
            const result = await LogParserService.processLogFile(buffer, key, isGzipped);
            
            console.log('Parsed', result.logs.length, 'log entries');
            
            res.json({
                success: true,
                logs: result.logs,
                metadata: result.metadata
            });
            
        } catch (error) {
            console.error('Error downloading log:', error);
            
            let errorMessage = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ 
                error: errorMessage
            });
        }
    });

    /**
     * POST /api/sync/import-file - Import a single file to database
     */
    router.post('/import-file', async (req: Request, res: Response) => {
        try {
            const { s3Path }: S3PathRequest = req.body;
            
            if (!s3Path) {
                return res.status(400).json({ error: 'S3 path is required' });
            }

            const { bucket, key } = parseS3Path(s3Path);
            
            // Check if already processed
            const isProcessed = await dbManager.isFileProcessed(key);
            if (isProcessed) {
                return res.json({
                    success: true,
                    message: 'File already processed',
                    skipped: true
                });
            }
            
            // Download and process file
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key
            });
            
            const response = await s3Client.send(command);
            
            if (!response.Body) {
                throw new Error('Empty response body from S3');
            }
            
            const chunks: Buffer[] = [];
            for await (const chunk of response.Body as any) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            
            const isGzipped = key.endsWith('.gz') || key.endsWith('.gzip');
            const result = await LogParserService.processLogFile(buffer, key, isGzipped);
            
            // Insert logs into database (skip invalid records)
            let insertedCount = 0;
            for (const record of result.logRecords) {
                try {
                    await dbManager.insertLogRecord(record);
                    insertedCount++;
                } catch (error) {
                    console.warn(`Failed to insert log record: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    // Continue with other records
                }
            }
            
            // Mark file as processed
            await dbManager.insertProcessedFile({
                s3_key: key,
                log_count: insertedCount,
                file_size: buffer.length,
                processed_at: new Date().toISOString()
            });
            
            res.json({
                success: true,
                imported: insertedCount,
                metadata: result.metadata
            });
            
        } catch (error) {
            console.error('Error importing file:', error);
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * POST /api/sync/list-logs - List available log files (legacy endpoint)
     */
    router.post('/list-logs', async (req: Request, res: Response) => {
        try {
            const { s3Prefix }: S3PrefixRequest = req.body;
            
            if (!s3Prefix) {
                return res.status(400).json({ error: 'S3 prefix is required' });
            }

            console.log('Listing logs with prefix:', s3Prefix);
            
            const { bucket, key: prefix } = parseS3Path(s3Prefix);
            
            const command = new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                MaxKeys: 1000
            });
            
            const response = await s3Client.send(command);
            
            if (!response.Contents) {
                return res.json({ files: [], message: 'No log files found' });
            }
            
            const logFiles = response.Contents
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
                        s3Path: `s3://${bucket}/${obj.Key}`,
                        fileName: fileName,
                        size: obj.Size || 0,
                        lastModified: obj.LastModified,
                        date: parsedDate || obj.LastModified,
                        sizeFormatted: formatBytes(obj.Size || 0)
                    };
                })
                .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
            
            console.log(`Found ${logFiles.length} log files`);
            
            res.json({
                success: true,
                files: logFiles,
                bucket: bucket,
                prefix: prefix,
                totalFiles: logFiles.length
            });
            
        } catch (error) {
            console.error('Error listing logs:', error);
            res.status(500).json({ 
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * POST /api/sync/trigger-poll - Manually trigger S3 polling
     */
    router.post('/trigger-poll', async (req: Request, res: Response) => {
        try {
            if (!s3Poller) {
                return res.status(503).json({
                    error: 'S3 polling service not available'
                });
            }

            const result = await s3Poller.triggerPoll();
            
            res.json({
                success: true,
                result
            });
            
        } catch (error) {
            console.error('Error triggering poll:', error);
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/sync/status - Get polling service status
     */
    router.get('/status', (req: Request, res: Response) => {
        if (!s3Poller) {
            return res.json({
                pollingEnabled: false,
                message: 'S3 polling service not configured'
            });
        }

        const status = s3Poller.getStatus();
        res.json({
            pollingEnabled: true,
            ...status
        });
    });

    return router;
}