import { Router, Request, Response } from 'express';
import { SQLiteDBManager } from '../database/sqlite';
import { LogQueryParams } from '../types/bedrock';

export function createLogsRouter(dbManager: SQLiteDBManager): Router {
    const router = Router();

    /**
     * GET /api/logs - Query logs with filtering and pagination
     */
    router.get('/', async (req: Request, res: Response) => {
        try {
            const params: LogQueryParams = {
                search: req.query.search as string,
                model_id: req.query.model_id as string,
                status_code: req.query.status_code ? parseInt(req.query.status_code as string) : undefined,
                start_date: req.query.start_date as string,
                end_date: req.query.end_date as string,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
                offset: req.query.offset ? parseInt(req.query.offset as string) : 0
            };

            const result = await dbManager.queryLogs(params);
            
            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Error querying logs:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/logs/stats - Get aggregated statistics
     */
    router.get('/stats', async (req: Request, res: Response) => {
        try {
            const modelStats = await dbManager.getModelStats();
            
            res.json({
                success: true,
                stats: {
                    modelStats
                }
            });

        } catch (error) {
            console.error('Error getting stats:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/logs/recent - Get recent logs
     */
    router.get('/recent', async (req: Request, res: Response) => {
        try {
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
            const logs = await dbManager.getRecentLogs(limit);
            
            res.json({
                success: true,
                logs
            });

        } catch (error) {
            console.error('Error getting recent logs:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/logs/timeline - Get logs grouped by time periods for timeline view
     */
    router.get('/timeline', async (req: Request, res: Response) => {
        try {
            const groupByParam = (req.query.groupBy as string) || 'hour';
            const groupBy: 'hour' | 'day' | 'week' = ['hour', 'day', 'week'].includes(groupByParam) 
                ? groupByParam as 'hour' | 'day' | 'week' 
                : 'hour';
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
            const search = req.query.search as string;
            const modelId = req.query.modelId as string;
            const startDate = req.query.startDate as string;
            const endDate = req.query.endDate as string;

            const timelineData = await dbManager.getTimelineData({
                groupBy,
                limit,
                search,
                modelId,
                startDate,
                endDate
            });
            
            res.json({
                success: true,
                timeline: timelineData
            });

        } catch (error) {
            console.error('Error getting timeline data:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    return router;
}