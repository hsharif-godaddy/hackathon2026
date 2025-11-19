# Commerce Agent Prompts

This directory contains the modular prompt system for the Commerce Agent.

## Overview

The Commerce Agent is a specialized agent focused on product catalog operations. It fetches product data from the GoDaddy Commerce API and hands off to the Develop Agent for HTML rendering.

## Prompt Structure

### core.md

Defines the agent's identity, responsibilities, and boundaries. Emphasizes that the Commerce Agent does NOT render HTML or edit files - it only fetches product data.

### handoff-protocol.md

Specifies how to hand off product data to the Develop Agent, including:

- When to hand off
- What data to include
- Message format and structure
- Error handling

### communication.md

Defines the agent's communication style:

- Professional and concise tone
- Clear expectation setting
- Error messaging patterns
- Example responses

## Key Principles

1. **Single Responsibility** - Commerce Agent only fetches product data
2. **Clear Boundaries** - No HTML rendering, no file operations
3. **Structured Handoffs** - Always provide complete product data to Develop Agent
4. **User Transparency** - Keep users informed about what's happening

## Usage

These prompts are composed together by the Commerce Agent during initialization to create the complete system prompt.
