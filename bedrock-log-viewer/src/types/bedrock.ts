// Bedrock log entry types based on AWS CloudWatch logs format

export interface BedrockMessageContent {
  text?: string;
  toolUse?: {
    name: string;
    input: Record<string, any>;
  };
  toolResult?: {
    content: any;
  };
}

export interface BedrockMessage {
  role: 'user' | 'assistant' | 'system';
  content: BedrockMessageContent[];
}

export interface BedrockInputBody {
  messages: BedrockMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
}

export interface BedrockInput {
  inputContentType: string;
  inputBodyJson: BedrockInputBody;
  inputTokenCount?: number;
  cacheReadInputTokenCount?: number;
  cacheWriteInputTokenCount?: number;
}

export interface BedrockOutput {
  outputContentType?: string;
  outputBodyJson?: {
    output?: {
      message?: {
        role: string;
        content: BedrockMessageContent[];
      };
    };
    stopReason?: string;
    metrics?: {
      latencyMs?: number;
    };
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cacheReadInputTokens?: number;
      cacheWriteInputTokens?: number;
    };
  };
  outputTokenCount?: number;
}

export interface BedrockLogEntry {
  timestamp: string;
  accountId: string;
  identity?: {
    arn?: string;
  };
  region: string;
  operation?: string;
  modelId: string;
  input: BedrockInput;
  output?: BedrockOutput;
  inferenceRegion?: string;
  responseStatusCode?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  schemaType?: string;
  schemaVersion?: string;
  requestId?: string;
  billingDetails?: {
    billedCharacters?: number;
    billedUnits?: number;
  };
}

// Database types
export interface LogRecord {
  id?: number;
  timestamp: string;
  model_id: string;
  status_code: number;
  input_tokens: number;
  output_tokens: number;
  request_summary: string;
  full_log_json: string;
  s3_file_key: string;
  created_at?: string;
}

export interface ProcessedFile {
  id?: number;
  s3_key: string;
  processed_at: string;
  log_count: number;
  file_size: number;
}

// API types
export interface S3PathRequest {
  s3Path: string;
}

export interface S3PrefixRequest {
  s3Prefix: string;
}

export interface LogFileMetadata {
  key: string;
  s3Path: string;
  fileName: string;
  size: number;
  lastModified: Date;
  date: Date;
  sizeFormatted: string;
}

export interface LogAnalysisResult {
  success: boolean;
  logs: BedrockLogEntry[];
  metadata: {
    fileSize: number;
    decompressedSize: number;
    logCount: number;
    s3Path: string;
  };
}

export interface LogQueryParams {
  search?: string;
  model_id?: string;
  status_code?: number;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface LogQueryResult {
  logs: LogRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface TimelineQueryParams {
  groupBy: 'hour' | 'day' | 'week';
  limit: number;
  search?: string;
  modelId?: string;
  startDate?: string;
  endDate?: string;
}

export interface TimelineGroup {
  period: string;
  periodLabel: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  models: string[];
  logs: LogRecord[];
}

export interface TimelineData {
  groups: TimelineGroup[];
  totalRequests: number;
  dateRange: {
    start: string;
    end: string;
  };
}