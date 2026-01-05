# Git Operations Architecture

## Overview

The Git Operations Architecture provides automated version control for customer applications in the Airo AI platform. All git operations are managed by the agent through the dev-supervisor, ensuring complete isolation of the git repository from the agent container while maintaining comprehensive tracking of LLM interactions and tool executions.

## Core Principles

- **Agent-Driven Workflow**: All git operation logic and decision-making occurs within the agent
- **Repository Isolation**: The `.git` directory is never visible to the agent container
- **Feature Branch Isolation**: Each customer request operates in its own feature branch
- **Comprehensive Tracking**: Every tool call generates a commit for audit and rollback capabilities
- **Automatic Recovery**: Interrupted sessions are automatically detected and recovered
- **No LLM Git Tools**: Git operations are transparent to the LLM, this saves on costs as it reduces tool calls and context

## Feature Request Workflow

### Definition of a Feature

A "feature" represents a complete customer interaction session with the LLM, from initial prompt through all tool executions until the final response.

### Feature Branch Lifecycle

```mermaid
sequenceDiagram
    participant Customer
    participant Agent
    participant LLM
    participant DevSupervisor as dev-supervisor

    Customer->>Agent: Submit feature request
    Agent->>Agent: Execute git recovery check

    alt Recovery needed
        Agent->>DevSupervisor: Execute recovery workflow
    end

    Agent->>DevSupervisor: git checkout -b timestamp-requestId
    Agent->>LLM: Process customer request

    loop For each tool call
        LLM->>Agent: Execute tool
        Agent->>Agent: Process tool execution
        Agent->>DevSupervisor: Check for file changes

        alt Files changed
            Agent->>DevSupervisor: git add .
            Agent->>DevSupervisor: git commit -m "timestamp-tool_name"
        end
    end

    LLM->>Agent: End of message
    Agent->>DevSupervisor: Check for final changes

    alt Final changes exist
        Agent->>DevSupervisor: git add .
        Agent->>DevSupervisor: git commit -m "timestamp-end-of-message"
    end

    Agent->>Agent: Generate squash commit message
    Agent->>DevSupervisor: git checkout main
    Agent->>DevSupervisor: git merge --squash timestamp-requestId
    Agent->>DevSupervisor: git commit -m "meaningful_message"

    Agent->>Customer: Feature complete
```

### Branch Naming Convention

Feature branches follow the pattern: `{timestamp}-{requestId}`

**Examples:**

- `20240915143022-req_abc123def456`
- `20241201091500-req_xyz789uvw012`

**Components:**

- `timestamp`: UTC timestamp in `YYYYMMDDHHmmss` format
- `requestId`: Unique identifier for the customer's development session

```mermaid
graph TB
    subgraph "Branches"
        MAIN[main branch<br/>Production-ready state]
        FEAT1[20240915143022-req_abc123def456<br/>Customer Request 1]
        FEAT2[20250915143022-req_afsadf321243<br/>Customer Request 2]
        FEAT3[20260915143022-req_cxbvbcv56744<br/>Active Feature Branch]

        MAIN --> FEAT1
        MAIN --> FEAT2
        MAIN --> FEAT3
    end
```

### Automatic Commit Strategy

#### Tool Call Commits

After each tool execution, the agent checks for file changes and commits them:

```bash
# Pattern: timestamp-tool_name
git commit -m "20240915143055-search_replace"
git commit -m "20240915143128-write_file"
git commit -m "20240915143201-run_terminal_cmd"
```

#### End-of-Message Commits

After LLM completes its response, a final commit captures any remaining changes:

```bash
# Pattern: timestamp-end-of-message
git commit -m "20240915143245-end-of-message"
```

#### Squash Commit Generation

The agent uses an LLM to generate meaningful commit messages for the final merge:

**Input Context:**

- Original customer prompt
- Summary of files changed
- High-level description of modifications

**Generated Message Examples:**

- `Add user authentication with JWT tokens`
- `Implement responsive navigation component`
- `Fix API endpoint validation and error handling`

**Fallback:** If LLM generation fails, use: `{timestamp} - Feature implementation`

Example:

```bash
git checkout main && git merge --squash $previous_branch && git commit -m "$squash_message"
```

```mermaid
graph TB
    subgraph "Feature Commit History"
        C1[20240915143201-run_terminal_cmd]
        C2[20240915143055-search_replace]
        C3[20240915143128-write_file]
        C4[20240915143120-end-of-message]
        C5[Customer added authentication system]

        C1 --> C2
        C2 --> C3
        C3 --> C4
        C4 --> C5
    end
```

## Git Recovery Workflow

### Recovery Trigger

Before each new feature request, the agent checks if recovery is needed:

```mermaid
flowchart TD
    START[New Feature Request] --> CHECK{On main branch?}
    CHECK -->|Yes| PROCEED[Proceed with feature]
    CHECK -->|No| RECOVERY[Execute Recovery]

    RECOVERY --> UNCOMMITTED{Uncommitted changes?}
    UNCOMMITTED -->|Yes| COMMIT[Commit changes]
    UNCOMMITTED -->|No| DIFF[Get diff from main]

    COMMIT --> DIFF
    DIFF --> SIZE{Diff manageable?}

    SIZE -->|Yes| LLM_MSG[Generate commit message]
    SIZE -->|No| FALLBACK[Use fallback message]

    LLM_MSG --> SQUASH[Squash merge to main]
    FALLBACK --> SQUASH
    SQUASH --> NOTIFY[Notify LLM of recovery]
    NOTIFY --> PROCEED
```

### Recovery Process

1. **Branch Detection**: Check if current branch is not `main`
2. **Uncommitted Changes**: Commit any pending changes with recovery marker
3. **Diff Analysis**: Get changes between current branch and main
4. **Commit Message Generation**:
   - If diff is manageable: Use LLM to generate meaningful message
   - If diff is too large: Use fallback: `{timestamp} - Git recovery from unknown error`
5. **Squash Merge**: Merge feature branch to main with generated message
6. **LLM Notification**: Inform LLM about recovery and current state

### Recovery Commands

```bash
# Detect current branch
git branch --show-current

# Commit uncommitted changes if any
git add .
git commit -m "{timestamp}-recovery-uncommitted"

# Get diff for analysis
git diff main

# Squash merge to main
git checkout main
git merge --squash {previous_branch}
git commit -m "{generated_message}"
```

## Git Restore Operations

### Commit Preview System

Customers can preview commits before restoring:

1. **Temporary Checkout**: Application shows state at selected commit
2. **Chat Disabled**: Interface clearly indicates preview mode
3. **Easy Return**: Customer can return to current state without changes

### Restore Implementation

```mermaid
sequenceDiagram
    participant Customer
    participant Agent
    participant DevSupervisor as dev-supervisor

    Customer->>Agent: Request commit preview
    Agent->>DevSupervisor: git checkout {commit_id}
    Agent->>Customer: Show preview (chat disabled)

    alt Customer confirms restore
        Customer->>Agent: Confirm restore
        Agent->>DevSupervisor: git checkout main
        Agent->>DevSupervisor: git restore --source={commit_id} --staged --worktree .
        Agent->>DevSupervisor: git commit -m "Restore: Changes from commit {hash}"
        Agent->>Customer: Restore complete
    else Customer cancels
        Customer->>Agent: Cancel restore
        Agent->>DevSupervisor: git checkout main
        Agent->>Customer: Back to current state
    end
```

### Restore Process

1. **Checkout Main**: Ensure we're on main branch
2. **Restore Files**: Copy files from target commit to working directory and staging area
3. **Auto-Commit**: Create commit with restored changes

**Restore Commands:**

```bash
# Checkout main branch
git checkout main

# Restore files from target commit
git restore --source={commit_hash} --staged --worktree .

# Auto-commit the restored state
git commit -m "Restore: Changes from commit {hash}"
```

## Error Handling and Recovery

### Common Git Errors

The agent handles git errors through systematic recovery attempts:

#### Lock File Issues

```bash
# Error: .git/index.lock exists
# Recovery: Wait 5 seconds, then remove if persistent
rm .git/index.lock
```

#### Configuration Issues

```bash
# Error: Missing git configuration
# Recovery: Set default configuration
git config user.email "agent@airo.platform"
git config user.name "Airo Agent"
```

#### Repository Corruption

```bash
# Error: Repository integrity issues
# Recovery: Check and repair
git fsck --full
# If unsuccessful, restore from backup
```

#### Missing .git Directory

- **Recovery**: Lock application and escalate to support
- **Prevention**: Monitor file system operations

### Error Recovery Workflow

```mermaid
flowchart TD
    OPERATION[Git Operation] --> ERROR{Error occurred?}
    ERROR -->|No| SUCCESS[Operation Success]
    ERROR -->|Yes| ANALYZE[Analyze Error Type]

    ANALYZE --> LOCKFILE{Lock file error?}
    ANALYZE --> CONFIG{Config error?}
    ANALYZE --> CORRUPT{Corruption error?}
    ANALYZE --> MISSING{Missing .git?}

    LOCKFILE -->|Yes| WAIT[Wait and retry]
    CONFIG -->|Yes| SET_CONFIG[Reset configuration]
    CORRUPT -->|Yes| FSCK[Check integrity]
    MISSING -->|Yes| ESCALATE[Lock app, contact support]

    WAIT --> RETRY[Retry operation]
    SET_CONFIG --> RETRY
    FSCK --> BACKUP[Restore from backup]
    BACKUP --> RETRY

    RETRY --> FINAL{Success?}
    FINAL -->|Yes| SUCCESS
    FINAL -->|No| ESCALATE
```

### Error Handling Strategy

1. **Immediate Retry**: For transient issues (lock files, network)
2. **Configuration Reset**: For config-related errors
3. **Integrity Check**: For corruption detection
4. **Backup Restoration**: For severe corruption
5. **Support Escalation**: For unrecoverable issues

## Benefits and Advantages

### Development Workflow Benefits

- **Comprehensive Audit Trail**: Every tool call tracked in git history
- **Safe Experimentation**: Feature branches protect main development line
- **Automatic Recovery**: Handles interrupted sessions gracefully
- **Granular Rollbacks**: Restore to any point in development history
- **Troubleshooting**: Pinpoint exact operations that caused issues

### Operational Benefits

- **LLM Performance Analysis**: Identify problematic tool calls
- **Customer Support**: Clear history for debugging
- **Platform Improvement**: Data-driven insights for optimization
- **Disaster Recovery**: Comprehensive backup and restore capabilities

### Security Benefits

- **Repository Isolation**: Git operations completely isolated from agent
- **Audit Compliance**: Full traceability of all changes
- **Access Control**: All operations authenticated and authorized
- **Data Protection**: Automated backup and recovery systems

## Implementation Considerations

### Performance Optimization

- **Smart Commit Detection**: Only commit when files actually change
- **Read-Only Tool Filtering**: Skip commits for tools that don't modify files
- **Branch Retention Strategy**: Feature branches retained for debugging and audit
- **Automatic Cleanup**: Old branches cleaned up when count exceeds threshold
- **Repository Maintenance**: Automatic garbage collection after branch cleanup

### Branch Management Strategy

#### Branch Retention and Cleanup

Feature branches are retained after squash merge to provide debugging history and audit trail:

**Retention Policy:**

- Feature branches remain after merge to main
- Maximum branch count threshold: 50 branches
- When threshold exceeded: Delete oldest 25 branches
- Cleanup triggered automatically during merge operations

**Cleanup Workflow:**

1. Squash merge feature branch to main
2. Check total branch count (excluding main)
3. If count > 50: Delete oldest 25 branches (sorted by commit date)
4. Run `git gc --auto` to optimize repository
5. Continue normal operations

**Benefits:**

- **Debugging History**: Recent feature branches available for investigation
- **Audit Trail**: Historical branches preserved temporarily
- **Automatic Management**: No manual intervention required
- **Storage Optimization**: Git garbage collection after bulk deletions

**Commands:**

```bash
# After successful merge
git checkout main
git merge --squash {feature_branch}
git commit -m "{user_prompt}"

# Automatic cleanup if branch count > 50
git for-each-ref --sort=committerdate --format='%(refname:short)' refs/heads/
# Delete oldest 25 branches
git branch -D {old_branch_1} {old_branch_2} ... {old_branch_25}
git gc --auto  # Optimize repository
```

### Monitoring and Observability

- **Git Operation Metrics**: Track commit frequency, merge success, errors
- **Health Monitoring**: Repository integrity, branch state, lock file status
- **Error Analytics**: Pattern analysis for improving error handling
- **Performance Metrics**: Operation timing and repository size tracking

### Backup and Recovery

- **Automated Backups**: Repository snapshots after significant operations
- **Point-in-Time Recovery**: Restore to any previous state
- **Integrity Validation**: Automatic verification after recovery
- **Disaster Recovery**: Comprehensive procedures for catastrophic failures

---

_Document Version: 1.0_  
_Created: September 25, 2025_  
_Classification: Internal_  
_Audience: Platform Engineering & Development Teams_
