# Agentic QA

AI-powered QA testing framework for Airo Builder.

## Overview

Unlike traditional scripted tests, Agentic QA uses AI to navigate and test the application autonomously. You define **goals** (what to achieve), not **steps** (how to achieve it).

### Scripted Test vs Agentic Test

| Scripted (`user-journey.spec.ts`)      | Agentic (`create-site.yaml`)                |
| -------------------------------------- | ------------------------------------------- |
| `page.getByTestId('prompt').fill(...)` | `"Enter prompt to create Hello World site"` |
| Hardcoded selectors                    | AI understands natural language             |
| Breaks when UI changes                 | Self-healing - adapts to changes            |
| Manual iframe handling                 | Stagehand handles automatically             |

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy .env.example and fill in your credentials
cp agentic-qa/.env.example agentic-qa/.env
# Edit agentic-qa/.env with your credentials

# Run a specific scenario
pnpm --filter agentic-qa test scenarios/create-site.yaml

# Run all scenarios
pnpm --filter agentic-qa test --all

# Run with visible browser
pnpm --filter agentic-qa test --headed scenarios/create-site.yaml

# Run golden dataset (comprehensive test suite)
pnpm --filter agentic-qa test --all scenarios/golden-dataset/

# Run specific category from golden dataset
pnpm --filter agentic-qa test --all scenarios/golden-dataset/app-types/
```

## CLI Options

```
pnpm --filter agentic-qa test [options] [scenario-file]

Options:
  --all, -a           Run all scenarios in the scenarios directory
  --headed, -h        Run with visible browser (not headless)
  --model, -m <name>  AI model to use (default: anthropic/claude-sonnet-4-5-20250929)
  --verbose, -v       Enable verbose logging
  --output, -o <dir>  Output directory for reports (default: ./reports)
  --scenarios, -s <dir> Scenarios directory (default: ./scenarios)
  --help              Show help message
```

## Golden Dataset

A comprehensive test suite covering various app types and interactions:

| Category              | Scenarios | Description                                                     |
| --------------------- | --------- | --------------------------------------------------------------- |
| **App Types**         | 6         | Landing pages, e-commerce, portfolio, restaurant, blog, fitness |
| **Chat Interactions** | 5         | Adding sections, changing content, multi-turn conversations     |
| **Design Changes**    | 5         | Colors, dark mode, fonts, layout, animations                    |
| **Navigation**        | 4         | Sign-in, apps list, page routing                                |
| **Edge Cases**        | 6         | Ambiguous prompts, special characters, non-English, conflicts   |

**Total: 26 scenarios**

See `scenarios/golden-dataset/README.md` for detailed documentation.

## Creating Scenarios

Scenarios are defined in YAML files:

```yaml
name: Create Hello World Site
description: Create a website and verify it works

startUrl: https://airo-builder.godaddy.com
timeout: 420000 # 7 minutes
maxSteps: 100

credentials:
  username: ${TEST_USERNAME}
  password: ${TEST_PASSWORD}

# Deterministic site creation (login + prompt entry handled automatically)
sitePrompt:
  prompt: "Create a Hello World website with a hero section"

# Use common instructions
systemPrompt: |
  ${common.developPageBase}

  ${common.chatInstructions}

# AI agent focuses on verification and interactions
goal: |
  Verify the site was created successfully:
  - Preview iframe is visible
  - Site shows "Hello World" content
  - Hero section is present

cleanup:
  deleteAllSitesViaAPI: true
```

### Scenario Fields

| Field                | Required | Description                           |
| -------------------- | -------- | ------------------------------------- |
| `name`               | Yes      | Scenario name                         |
| `description`        | No       | Human-readable description            |
| `startUrl`           | Yes      | URL to start the test                 |
| `timeout`            | No       | Maximum time in ms (default: 300000)  |
| `maxSteps`           | No       | Maximum agent steps (default: 50)     |
| `headed`             | No       | Show browser window (default: false)  |
| `credentials`        | No       | Login credentials                     |
| `sitePrompt`         | No       | Deterministic site creation setup     |
| `systemPrompt`       | No       | Custom instructions for the agent     |
| `goal`               | Yes      | What the agent should accomplish      |
| `dependsOn`          | No       | Name of scenario that must pass first |
| `previewScreenshots` | No       | Configure preview site screenshots    |
| `cleanup`            | No       | Cleanup actions after test            |

### Site Prompt (Deterministic Setup)

The `sitePrompt` field enables deterministic (non-AI) handling of initial site creation:

```yaml
sitePrompt:
  prompt: "Create a simple Hello World website"
  handleLogin: true # Default: true - handles SSO login deterministically
```

When enabled, the runner:

1. Navigates to `https://sso.godaddy.com/login` and logs in using credentials
2. Navigates to the Airo app (`startUrl`)
3. Enters the prompt using Playwright selectors
4. Clicks "Start building"

This is more reliable than having the AI agent handle login and prompt entry.

### Preview Screenshots

After the agent completes, the runner automatically navigates to the built website preview and captures screenshots:

```yaml
previewScreenshots:
  enabled: true # Enable/disable (default: true)
  fullPage: true # Capture full page (default: true)
  waitMs: 3000 # Wait time before screenshot (default: 2000)
  scrollPositions: # Positions to screenshot (default: [top])
    - top
    - middle
    - bottom
  captureAllPages: true # Navigate to all links and screenshot each page
  maxPages: 10 # Maximum pages to capture (default: 10)
```

This captures screenshots at different scroll positions, useful for reviewing:

- Hero sections (top)
- Content sections (middle)
- Footer and CTAs (bottom)

With `captureAllPages: true`, the runner also discovers all internal links in the created site and takes screenshots of each page.

### Common Instructions

Reuse prompts across scenarios using `scenarios/common/instructions.yaml`:

```yaml
# scenarios/common/instructions.yaml
developPageBase: |
  You are a QA tester for Airo Builder. You are on the develop page...

chatInstructions: |
  When sending chat messages:
  - Type the message in the chat input
  - Submit and wait for the site to update...
```

Reference in scenarios with `${common.keyName}`:

```yaml
# scenarios/my-test.yaml
systemPrompt: |
  ${common.developPageBase}

  ${common.chatInstructions}

  Additional scenario-specific instructions...
```

Available common prompts:

- `${common.developPageBase}` - Base prompt for develop page scenarios
- `${common.chatInstructions}` - How to send chat messages
- `${common.waitInstructions}` - Patience instructions for loading
- `${common.verifyInstructions}` - How to verify changes

## Reports

After running tests, reports are saved to `./reports/`:

- **JSON report**: Machine-readable results with all metrics
- **HTML report**: Human-readable report with pass/fail status, screenshots, and action logs

## AI Models

Supported models (via Stagehand):

- `anthropic/claude-sonnet-4-5-20250929` (default)
- `anthropic/claude-haiku-4-5-20251001`
- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `google/gemini-2.5-flash`

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   CLI Runner    │────▶│  Scenario Loader │
└─────────────────┘     └──────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│    Stagehand    │────▶│   AI Model       │
│    (Browser)    │     │  (Claude/GPT)    │
└─────────────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│   Airo Builder  │────▶│    Evaluator     │
│      (App)      │     │    (Reports)     │
└─────────────────┘     └──────────────────┘
```

## Development

```bash
# Type check
pnpm --filter agentic-qa typecheck

# Build
pnpm --filter agentic-qa build
```

## Environment Variables

Create a `.env` file in the `agentic-qa/` directory (copy from `.env.example`):

```bash
cp agentic-qa/.env.example agentic-qa/.env
```

| Variable             | Required        | Description                                         |
| -------------------- | --------------- | --------------------------------------------------- |
| `TEST_USERNAME`      | Yes             | GoDaddy test account username                       |
| `TEST_PASSWORD`      | Yes             | GoDaddy test account password                       |
| `ANTHROPIC_API_KEY`  | If using Claude | Anthropic API key                                   |
| `ANTHROPIC_BASE_URL` | No              | Custom Anthropic API URL (default: Anthropic's API) |
| `OPENAI_API_KEY`     | If using GPT    | OpenAI API key                                      |
| `OPENAI_BASE_URL`    | No              | Custom OpenAI API URL                               |

Example `.env` file:

```bash
TEST_USERNAME=your-test-username
TEST_PASSWORD=your-test-password
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_BASE_URL=https://caas-gocode-prod.caas-prod.prod.onkatana.net
```
