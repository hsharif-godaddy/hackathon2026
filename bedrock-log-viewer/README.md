# Bedrock Log Viewer

A standalone webapp to download, browse, and analyze AWS Bedrock logs from S3.

## Features

### 🔍 **Log Browser**
- Browse and list log files from S3 directories
- Filter by date and sort by various criteria
- One-click loading of selected log files
- Visual file selection with metadata display

### 📊 **Log Analysis**
- Download gzipped log files from S3
- Parse and display Bedrock invocation logs
- Smart message summaries with expandable details
- Show statistics like token usage, success rates, and model usage
- HTML-safe rendering for all content

### 🎯 **Dual Interface**
- **Direct Path**: Enter specific S3 file paths
- **Browse Logs**: Explore directories and select files visually

## Setup

1. **AWS Authentication**: Make sure you're logged in with the correct AWS profile:
   ```bash
   aws sso login --profile airobuild-dev-private-sso
   ```

2. **Install Dependencies**: From the project root:
   ```bash
   pnpm install
   ```

3. **Start the Server**: From the bedrock-log-viewer directory:
   ```bash
   pnpm run dev
   ```
   
   The app will be available at http://localhost:3001

## Usage

### Browse Mode (Recommended)
1. Open http://localhost:3001 in your browser
2. Click the **"Browse Logs"** tab
3. Enter an S3 directory prefix (e.g., `s3://bucket/path/to/logs/`)
4. Click **"Browse Files"** to list available log files
5. Use filters to sort by date, size, etc.
6. Click **"Load"** on any file to analyze it

### Direct Path Mode
1. Open http://localhost:3001 in your browser
2. Use the **"Direct Path"** tab (default)
3. Enter the complete S3 path to a specific log file
4. Click **"Download & Analyze"** to fetch and parse the logs

## Sample Paths

**For browsing (directory):**
```
s3://airo-builder-bedrock-logs/AWSLogs/694282668781/BedrockModelInvocationLogs/us-west-2/
```

**For direct access (specific file):**
```
s3://airo-builder-bedrock-logs/AWSLogs/694282668781/BedrockModelInvocationLogs/us-west-2/2025/09/24/20/20250924T204404501Z_edb47370dbe4f3be.json.gz
```

## Log Analysis

The viewer provides:
- **Total Requests**: Number of API calls in the log
- **Most Used Model**: Which Bedrock model was called most frequently  
- **Success Rate**: Percentage of successful (200 status) requests
- **Token Usage**: Input and output token counts
- **Smart Summaries**: Extracted user request summaries
- **Expandable Details**: Click any entry to see full conversation flow
- **Raw JSON**: Complete technical details for each log entry

## File Format

Supports AWS Bedrock invocation logs in JSON Lines format (one JSON object per line), optionally gzipped.

## Log Browser Features

### File Listing
- Lists all `.json` and `.json.gz` files in the specified S3 prefix
- Shows file size, timestamp, and S3 key path
- Supports up to 1000 files per directory

### Filtering & Sorting
- **Date Filter**: Show only files from a specific date
- **Sort Options**: 
  - Newest/Oldest first
  - Largest/Smallest files first

### Security
- All HTML content is properly escaped
- Safe rendering of user inputs and log content
- No risk of XSS from log data containing HTML/scripts