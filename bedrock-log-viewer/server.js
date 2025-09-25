const express = require('express');
const cors = require('cors');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const zlib = require('zlib');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Load environment variables
require('dotenv').config();

// AWS S3 client configuration using the airobuild-dev-private-sso profile
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-west-2',
    // The AWS SDK will automatically use the profile specified in AWS_PROFILE environment variable
});

// Helper function to parse S3 path
function parseS3Path(s3Path) {
    const match = s3Path.match(/^s3:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
        throw new Error('Invalid S3 path format. Expected: s3://bucket-name/path/to/file');
    }
    return {
        bucket: match[1],
        key: match[2]
    };
}

// Helper function to decompress gzip data
function decompressGzip(buffer) {
    return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

// Helper function to parse log data
function parseLogData(data) {
    const logs = [];
    const lines = data.toString('utf-8').trim().split('\n');
    
    for (const line of lines) {
        if (line.trim()) {
            try {
                const logEntry = JSON.parse(line);
                logs.push(logEntry);
            } catch (error) {
                console.warn('Failed to parse log line:', error.message);
                // Continue processing other lines
            }
        }
    }
    
    return logs;
}

// API endpoint to list available log files
app.post('/api/list-logs', async (req, res) => {
    try {
        const { s3Prefix } = req.body;
        
        if (!s3Prefix) {
            return res.status(400).json({ error: 'S3 prefix is required' });
        }

        console.log('Listing logs with prefix:', s3Prefix);
        
        // Parse S3 path to get bucket and prefix
        const { bucket, key: prefix } = parseS3Path(s3Prefix);
        
        // List objects with the given prefix
        const command = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1000 // Limit to prevent too many results
        });
        
        const response = await s3Client.send(command);
        
        if (!response.Contents) {
            return res.json({ files: [], message: 'No log files found' });
        }
        
        // Filter and format the log files
        const logFiles = response.Contents
            .filter(obj => obj.Key.endsWith('.json.gz') || obj.Key.endsWith('.json'))
            .map(obj => {
                // Extract date/time from the file path
                const pathParts = obj.Key.split('/');
                const fileName = pathParts[pathParts.length - 1];
                
                // Try to extract timestamp from filename (format: YYYYMMDDTHHMMSSZ_*.json.gz)
                const timestampMatch = fileName.match(/(\d{8}T\d{6})/);
                let parsedDate = null;
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
                    key: obj.Key,
                    s3Path: `s3://${bucket}/${obj.Key}`,
                    fileName: fileName,
                    size: obj.Size,
                    lastModified: obj.LastModified,
                    date: parsedDate || obj.LastModified,
                    sizeFormatted: formatBytes(obj.Size)
                };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date descending
        
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
        
        let errorMessage = error.message;
        if (error.name === 'NoSuchBucket') {
            errorMessage = 'The specified S3 bucket does not exist';
        } else if (error.name === 'AccessDenied') {
            errorMessage = 'Access denied. Make sure you have permission to list objects in this S3 bucket';
        }
        
        res.status(500).json({ 
            error: errorMessage,
            details: error.name 
        });
    }
});

// Helper function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// API endpoint to download and process log files
app.post('/api/download-log', async (req, res) => {
    try {
        const { s3Path } = req.body;
        
        if (!s3Path) {
            return res.status(400).json({ error: 'S3 path is required' });
        }

        console.log('Downloading log from:', s3Path);
        
        // Parse S3 path
        const { bucket, key } = parseS3Path(s3Path);
        
        // Download file from S3
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });
        
        const response = await s3Client.send(command);
        
        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        
        console.log('Downloaded file size:', buffer.length, 'bytes');
        
        // Check if file is gzipped based on extension or content
        let data = buffer;
        if (key.endsWith('.gz') || key.endsWith('.gzip')) {
            console.log('Decompressing gzipped file...');
            data = await decompressGzip(buffer);
            console.log('Decompressed size:', data.length, 'bytes');
        }
        
        // Parse the log data
        const logs = parseLogData(data);
        
        console.log('Parsed', logs.length, 'log entries');
        
        res.json({
            success: true,
            logs: logs,
            metadata: {
                fileSize: buffer.length,
                decompressedSize: data.length,
                logCount: logs.length,
                s3Path: s3Path
            }
        });
        
    } catch (error) {
        console.error('Error downloading log:', error);
        
        let errorMessage = error.message;
        if (error.name === 'NoSuchBucket') {
            errorMessage = 'The specified S3 bucket does not exist';
        } else if (error.name === 'NoSuchKey') {
            errorMessage = 'The specified S3 key does not exist';
        } else if (error.name === 'AccessDenied') {
            errorMessage = 'Access denied. Make sure you have permission to access this S3 resource and that you are logged in with the correct AWS profile';
        }
        
        res.status(500).json({ 
            error: errorMessage,
            details: error.name 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Bedrock Log Viewer running at http://localhost:${port}`);
    console.log('Make sure you are logged in with: aws sso login --profile airobuild-dev-private-sso');
});