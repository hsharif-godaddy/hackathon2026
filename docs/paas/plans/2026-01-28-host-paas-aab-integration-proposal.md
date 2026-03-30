---
status: superseded
---

# Host-PaaS and AAB Integration - Design Proposal

**Problem:** Host-PaaS bypasses AAB by calling V2 APIs directly during signup, resulting in no AAB database record. This creates two issues: (1) Transitioning apps from PaaS to AAB requires a defined migration process, and (2) Agent-token generation currently relies on AAB APIs that call V2 directly without local DB validation—if AAB later adds enhanced ownership checks against its own database, the flow will break for PaaS-created apps.

---

## Option 1: Direct V2 API Calls (Current)

```mermaid
flowchart LR
    subgraph V2Cell["V2 Cell"]
        Agent[Agent] <--> Preview[Preview]
        Agent <--> Publish[Publish]
    end

    UI[Host-PaaS UI] --> BFF[Host-PaaS BFF]
    BFF -->|Signup| V2[V2 Control Plane]
    V2 --> V2Cell
    BFF -->|Token Request| AAB[AAB App]
    AAB -.->|No DB record| Warning[/"⚠️ Security Risk"/]
    UI -->|Connect| Agent

    style Warning fill:#ffcccc,stroke:#cc0000
```

| Pros                                | Cons                                          |
| ----------------------------------- | --------------------------------------------- |
| Simpler architecture, no middleware | Security risk - no local ownership validation |
| Less latency (no extra hop)         | Transition requires migration jobs            |
| Capability isolation by default     | Duplicate logic across systems                |
|                                     | No unified audit trail                        |

---

## Option 2: Create Apps via AAB API

```mermaid
flowchart LR
    subgraph V2Cell["V2 Cell"]
        Agent[Agent] <--> Preview[Preview]
        Agent <--> Publish[Publish]
    end

    UI[Host-PaaS UI] --> BFF[Host-PaaS BFF]
    BFF -->|Signup| AAB[AAB App]
    AAB --> AABDB[(AAB DB)]
    AAB --> V2[V2 Control Plane]
    V2 --> V2Cell
    BFF -->|Token Request| AAB
    AAB -.->|DB validated| Success[/"✅ Secure"/]
    UI -->|Connect| Agent

    style Success fill:#ccffcc,stroke:#00cc00
```

| Pros                                              | Cons                                                |
| ------------------------------------------------- | --------------------------------------------------- |
| Secure & consistent                               | Need whitelist-based capability control per product |
| Less effort transitions (capability flag changes) | Additional latency (+1 hop)                         |
| Single source of truth                            | AAB outage affects PaaS                             |
| Unified audit trail                               | Deployment coupling                                 |

---

## Critical Decision Factors

| Factor                 | Option 1                       | Option 2                     |
| ---------------------- | ------------------------------ | ---------------------------- |
| **Security**           | Risk - no local validation     | Secure - DB validation       |
| **Transition**         | High effort (migration jobs)   | Low effort (flag update)     |
| **Capability Control** | Not needed (natural isolation) | Whitelist mechanism required |
| **Data Consistency**   | Risk of drift                  | Guaranteed                   |

---

## Next Steps

1. Review with Host-PaaS and AAB teams
2. Decide based on security vs complexity trade-off
3. Plan migration for existing PaaS apps if Option 2 selected
