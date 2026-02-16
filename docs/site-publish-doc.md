# Airo Publish Workflow

## Chosen Implementation: Customer-Initiated Publish (UI → API → StepFunctions)

```mermaid
sequenceDiagram
    participant Customer
    participant UI
    participant Agent
    participant AiroService as Airo Service
    participant StepFunctions as StepFunctions<br/>(AiroPublish)
    participant Hosting as hosting service
    participant Nomad
    participant ProdApp as Airo Prod App
    Customer->>UI: Click Publish
    UI->>Agent: Get commit hash and start archive create
    Agent-->>UI: Pass commit hash with publish
    UI->>AiroService: POST /publish with commit and other payload
    AiroService->>StepFunctions: Start AiroPublish workflow
    StepFunctions-->>AiroService: Workflow started
    AiroService-->>UI: 202 Accepted
    Note over UI,Hosting: UI polls Airo service for prod status
    rect rgb(240, 248, 255)
        Note over StepFunctions,ProdApp: Step 1: Deploy to Nomad
        StepFunctions->>Hosting: Execute Step 1: Deploy
        Hosting->>Nomad: Deploy job (env: publish/prod)
        Nomad-->>Hosting: Job deploy initiated
        Nomad->>ProdApp: Start prod job (single Node image)
        Note over Nomad,ProdApp: Untar production archive, run bundled JavaScript
        Hosting-->>StepFunctions: Step 1 complete
    end
    rect rgb(255, 248, 240)
        Note over StepFunctions,ProdApp: Step 2: Health Check
        StepFunctions->>Hosting: Execute Step 2: Health check
        loop Health check with retries
            Hosting->>ProdApp: GET on publish domain
            alt Not healthy yet
                ProdApp-->>Hosting: Unhealthy/Not ready
                Note over Hosting: Wait and retry
            else Healthy
                ProdApp-->>Hosting: 200 OK (healthy)
            end
        end
        Hosting-->>StepFunctions: Step 2 complete (healthy)
    end
    rect rgb(240, 255, 240)
        Note over StepFunctions,Hosting: Step 3: Set Active
        StepFunctions->>Hosting: Execute Step 3: Set active
        Hosting->>Hosting: Update prod status to "active"
        Hosting-->>StepFunctions: Step 3 complete
        StepFunctions-->>AiroService: Workflow complete
    end
    UI->>AiroService: Poll GET /prod/status
    AiroService->>Hosting: Get prod status
    Hosting-->>AiroService: Status: "active"
    AiroService-->>UI: Status: "active"
    Note over UI,ProdApp: After getting "active", UI can also poll prod app
    UI->>ProdApp: GET /health (optional verification)
    ProdApp-->>UI: 200 OK
    UI->>Customer: Show prod app active + URL
    Note over UI,Customer: Survives reloads:<br/>UI checks Airo→hosting for status,<br/>then optionally verifies prod app directly
```

### How It Works

1. **Customer initiates publish** - Clicks publish button in UI
2. **Agent prepares build** - UI requests commit hash, Agent builds app and creates production archive (dist/ folder only)
3. **API starts workflow** - UI calls Airo service with commit hash and payload
4. **StepFunctions orchestrates deployment**:
   - **Step 1**: Deploy to Nomad (single Node image, untar archive, run bundled JavaScript)
   - **Step 2**: Health check with retries on publish domain
   - **Step 3**: Mark prod app as "active"
5. **UI polls for status** - Continuously checks Airo service for prod status
6. **Customer sees result** - UI displays active status + prod URL

### Key Characteristics

- **Simple architecture**: 3 components (UI, Airo Service, StepFunctions)
- **Immediate workflow start**: No queue delays
- **Health checks handle build timing**: Retries accommodate archive extraction + build time
- **State persists across reloads**: UI polls hosting service status, survives page refreshes

---

## Future: Agent-Initiated Publish (Agent → SQS → Poller → StepFunctions)

**Use case: Automated publish triggered by Agent (no customer interaction)**

```mermaid
sequenceDiagram
    participant Customer
    participant UI
    participant Agent
    participant SQS as AiroPublishProd<br/>SQS Queue
    participant Poller as AiroPublishPoller
    participant StepFunctions as StepFunctions<br/>(AiroPublish)
    participant AiroService as Airo Service
    participant Hosting as hosting service
    participant Nomad
    participant ProdApp as Airo Prod App

    Note over Agent: Agent detects trigger<br/>(git push, schedule, etc.)

    Agent->>Agent: Get commit hash and build app
    Agent->>Agent: Create production archive (dist/ folder only)
    Agent->>SQS: Send message (build ready + commit hash)

    Note over UI,Hosting: UI polls Airo service for prod status (if loaded)

    Poller->>SQS: Poll for messages
    SQS-->>Poller: Message received (build ready)
    Poller->>StepFunctions: Start AiroPublish workflow with payload
    StepFunctions-->>Poller: Workflow started
    Poller->>SQS: Delete message

    rect rgb(240, 248, 255)
        Note over StepFunctions,ProdApp: Step 1: Deploy to Nomad
        StepFunctions->>Hosting: Execute Step 1: Deploy
        Hosting->>Nomad: Deploy job (env: publish/prod)
        Nomad-->>Hosting: Job deploy initiated
        Nomad->>ProdApp: Start prod job (single Node image)
        Note over Nomad,ProdApp: Untar production archive, run bundled JavaScript
        Hosting-->>StepFunctions: Step 1 complete
    end

    rect rgb(255, 248, 240)
        Note over StepFunctions,ProdApp: Step 2: Health Check
        StepFunctions->>Hosting: Execute Step 2: Health check
        loop Health check with retries
            Hosting->>ProdApp: GET on publish domain
            alt Not healthy yet
                ProdApp-->>Hosting: Unhealthy/Not ready
                Note over Hosting: Wait and retry
            else Healthy
                ProdApp-->>Hosting: 200 OK (healthy)
            end
        end
        Hosting-->>StepFunctions: Step 2 complete (healthy)
    end

    rect rgb(240, 255, 240)
        Note over StepFunctions,Hosting: Step 3: Set Active
        StepFunctions->>Hosting: Execute Step 3: Set active
        Hosting->>Hosting: Update prod status to "active"
        Hosting-->>StepFunctions: Step 3 complete
    end

    opt UI is loaded
        UI->>AiroService: Poll GET /prod/status
        AiroService->>Hosting: Get prod status
        Hosting-->>AiroService: Status: "active"
        AiroService-->>UI: Status: "active"

        Note over UI,ProdApp: After getting "active", UI can also poll prod app

        UI->>ProdApp: GET /health (optional verification)
        ProdApp-->>UI: 200 OK

        UI->>Customer: Show prod app active + URL
    end

    Note over Customer,ProdApp: Publish completes automatically<br/>UI shows status if/when customer loads page
```

### How It Works

1. **Agent detects trigger** - Git push to main, scheduled publish, or other automation
2. **Agent prepares build** - Gets commit hash, builds app, creates production archive (dist/ folder only)
3. **Message sent to SQS** - Agent sends message to `AiroPublishProd` queue with commit hash and payload
4. **Poller processes queue** - Dedicated poller picks up message and starts StepFunctions workflow
5. **StepFunctions orchestrates deployment** - Same 3-step process as customer-initiated
6. **UI shows status (if loaded)** - Customer can view status if they happen to load the page

### Key Characteristics

- **Fully automated**: No customer interaction required
- **Build guaranteed complete**: Message only sent after Agent finishes build
- **Loose coupling**: Agent doesn't call control plane directly
- **Queue durability**: Message persists even if poller crashes
- **Same deployment process**: Reuses existing StepFunctions workflow

### When to Implement

This approach is planned for future scenarios where:

- Automated publishing on git push is desired
- Scheduled production deployments are needed
- Build completion guarantees are critical (eliminates timing race)
- Agent needs to trigger deploys without UI involvement

---

## Implementation Notes

### Current State Tracking

Both approaches rely on the hosting service tracking prod app status (`active`, `pending`, `failed`). This allows:

- UI to poll for status without knowing about StepFunctions execution
- State to survive page reloads
- Same UI code regardless of trigger mechanism (customer vs. agent)

### Workflow Execution

The StepFunctions `AiroPublish` workflow is identical for both approaches:

1. Deploy to Nomad with `publish/prod` environment
2. Health check with retries on publish domain
3. Set prod status to "active"

The only difference is **how the workflow starts**:

- Customer-initiated: API call from UI
- Agent-initiated: Poller reading from SQS queue
