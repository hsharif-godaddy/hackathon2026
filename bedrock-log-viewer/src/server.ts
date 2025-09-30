import express from 'express';
import cors from 'cors';
import { S3Client } from '@aws-sdk/client-s3';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { SQLiteDBManager } from './database/sqlite';
import { S3PollerService, S3PollerConfig } from './services/s3-poller';
import { createLogsRouter } from './routes/logs';
import { createSyncRouter } from './routes/sync';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// AWS S3 client configuration
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-west-2',
});

// Database setup
const dbManager = new SQLiteDBManager('./bedrock_logs.db');

// S3 Polling service (optional)
let s3Poller: S3PollerService | undefined;

async function initializeServices(): Promise<void> {
    try {
        // Initialize database
        await dbManager.initialize();
        console.log('Database initialized successfully');

        // Setup S3 polling if configured
        const pollingConfig: S3PollerConfig | undefined = process.env.S3_POLLING_ENABLED === 'true' ? {
            bucketName: process.env.S3_BUCKET_NAME || 'airo-builder-bedrock-logs',
            prefix: process.env.S3_PREFIX || 'AWSLogs/694282668781/BedrockModelInvocationLogs/us-west-2/',
            pollInterval: process.env.S3_POLL_INTERVAL || '*/10 * * * *', // Every 10 minutes
            maxFilesPerPoll: parseInt(process.env.S3_MAX_FILES_PER_POLL || '50'),
            region: process.env.AWS_REGION || 'us-west-2'
        } : undefined;

        if (pollingConfig) {
            s3Poller = new S3PollerService(pollingConfig, dbManager);
            s3Poller.start();
            console.log('S3 polling service started');
        } else {
            console.log('S3 polling service disabled (set S3_POLLING_ENABLED=true to enable)');
        }

    } catch (error) {
        console.error('Failed to initialize services:', error);
        process.exit(1);
    }
}

// API Routes
app.use('/api/logs', createLogsRouter(dbManager));
app.use('/api', createSyncRouter(s3Client, dbManager, s3Poller));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: 'connected',
        polling: s3Poller ? s3Poller.getStatus().running : false
    });
});

// Serve the timeline interface as the default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Keep the old interface available at /legacy
app.get('/legacy', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/legacy.html'));
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully');
    
    if (s3Poller) {
        s3Poller.stop();
    }
    
    await dbManager.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully');
    
    if (s3Poller) {
        s3Poller.stop();
    }
    
    await dbManager.close();
    process.exit(0);
});

// Start server
async function startServer(): Promise<void> {
    await initializeServices();
    
    app.listen(port, () => {
        console.log(`Bedrock Log Viewer v2.0 running at http://localhost:${port}`);
        console.log('Features:');
        console.log('  - Enhanced TypeScript backend with SQLite storage');
        console.log('  - Automatic S3 polling and log ingestion');
        console.log('  - Advanced search and filtering capabilities');
        console.log('  - Persistent log storage and analytics');
        console.log('');
        console.log('Make sure you are logged in with: aws sso login --profile airobuild-dev-private-sso');
        
        if (s3Poller) {
            console.log(`S3 polling enabled for: s3://${s3Poller.getStatus().config.bucketName}/${s3Poller.getStatus().config.prefix}`);
        }
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});