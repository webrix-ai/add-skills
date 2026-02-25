---
name: mcp-server-security-review
displayName: MCP Server Security Review
tagline: Evaluate an MCP server's security posture covering credentials, data exposure, and permissions.
description: |
  Performs a structured security audit of an MCP server by reviewing its source code
  for credential handling, data exposure risks, permission scope, transport security,
  code quality, and documentation. Scores each dimension, checks for common
  vulnerabilities (hardcoded secrets, eval injection, path traversal), and produces
  a review report with an approve/conditional/reject recommendation.
department:
  - Security & Compliance
  - Engineering
  - Cloud Security
use_cases:
  - Code Review
  - Threat Modeling
  - Compliance Audit
tools_required:
  - GitHub MCP
agents_compatible:
  - Claude / Claude Code
  - Cursor
  - Windsurf
  - ChatGPT
  - GitHub Copilot
  - Any MCP-compatible agent
author: Webrix
verified: true
updatedAt: 2026-02-24
version: 1.0.0
exampleInput: |
  MCP server: https://github.com/example-org/slack-mcp-server
  Transport: stdio
  Purpose: Allow AI agents to read/post Slack messages and manage channels
  Intended users: Engineering team (15 developers)
exampleOutput: |
  MCP Server Security Review — slack-mcp-server

  OVERALL RISK: Medium (21/30) — Use with additional monitoring

  DIMENSION SCORES
  | Dimension            | Score | Key Finding                              |
  |----------------------|-------|------------------------------------------|
  | Credential Handling  | 4/5   | Uses env vars, no hardcoded secrets      |
  | Data Exposure        | 3/5   | Message content returned unfiltered       |
  | Permission Scope     | 3/5   | Write access to channels (overly broad)  |
  | Transport Security   | 4/5   | stdio only, no network exposure          |
  | Code Quality         | 4/5   | TypeScript, good error handling          |
  | Documentation        | 3/5   | Missing data flow diagram                |

  VULNERABILITIES FOUND
  ⚠️ [Medium] Tool "post_message" has no content filtering — could leak PII
  ⚠️ [Medium] Channel management tools (create/archive) not needed for stated use
  ⚠️ [Low] No rate limiting on message reads — could hit Slack API limits
  ✅ No hardcoded secrets
  ✅ Input validation on channel IDs
  ✅ npm audit: 0 vulnerabilities

  RECOMMENDATIONS
  1. Restrict to read-only tools (remove post_message, manage_channel)
  2. Add content filtering to redact emails/phone numbers from responses
  3. Implement rate limiting (max 100 requests/minute)

  APPROVED: Conditional — implement recommendations before production use
---

# MCP Server Security Review

Evaluate an MCP server's security posture: credential handling, data exposure, permission scope, and transport security.

**Integrations:** GitHub

## When to Use

- The user wants to evaluate an MCP server before installing it
- A security review is needed for a new MCP integration
- The user mentions "MCP security", "MCP review", "is this MCP server safe", or "MCP audit"
- Teams are creating an approved MCP server catalog

## Steps

### Step 1: Gather MCP Server Information

Ask the user for:

1. **MCP server source** — GitHub URL, npm package, or local path
2. **Server type** — stdio, SSE, or HTTP transport
3. **What it accesses** — APIs, databases, file system, network resources
4. **Intended use** — What workflows will it support

### Step 2: Review Source Code

Clone or read the MCP server repository and evaluate:

**Credential Handling:**
- How are API keys and secrets provided? (env vars, config files, args)
- Are secrets logged or exposed in error messages?
- Is there a `.env.example` or documentation for required credentials?
- Are credentials validated before use?

**Data Exposure:**
- What data flows through the server? (user prompts, file contents, API responses)
- Is sensitive data filtered or redacted before returning to the agent?
- Are there data retention or caching mechanisms?
- Is data sent to external services beyond the declared integration?

**Permission Scope:**
- What tools does the server expose? Are they read-only or read-write?
- Is the permission scope minimal (principle of least privilege)?
- Can the server modify files, make network requests, or execute commands?
- Are there guardrails to prevent destructive operations?

**Transport Security:**
- For SSE/HTTP: Is TLS required? Are connections authenticated?
- For stdio: Is the binary from a trusted source?
- Are inputs validated and sanitized?
- Is there protection against injection attacks in tool arguments?

### Step 3: Score the Security Posture

Rate each dimension from 1 (critical risk) to 5 (excellent):

| Dimension | Score | Findings |
|-----------|-------|----------|
| Credential Handling | X/5 | ... |
| Data Exposure | X/5 | ... |
| Permission Scope | X/5 | ... |
| Transport Security | X/5 | ... |
| Code Quality | X/5 | ... |
| Documentation | X/5 | ... |

**Overall Risk Level:**
- 25-30: Low Risk — Safe to use with standard precautions
- 18-24: Medium Risk — Use with additional monitoring and restrictions
- 12-17: High Risk — Requires remediation before production use
- 6-11: Critical Risk — Do not use until issues are resolved

### Step 4: Check for Common Vulnerabilities

Specifically look for:

- [ ] Hardcoded secrets or API keys in source
- [ ] `eval()` or dynamic code execution with user input
- [ ] Unrestricted file system access (path traversal)
- [ ] Missing input validation on tool arguments
- [ ] HTTP requests without TLS
- [ ] Excessive permissions (write access when read-only would suffice)
- [ ] No error handling (stack traces exposed to agent)
- [ ] Dependencies with known vulnerabilities (run `npm audit` or equivalent)
- [ ] Missing or permissive CORS configuration
- [ ] No rate limiting on resource-intensive operations

### Step 5: Generate Review Report

Create a structured report with:

1. **Executive Summary** — Overall risk level, recommendation (approve/conditional/reject)
2. **Findings Table** — Each finding with severity, description, and remediation
3. **Architecture Diagram** — Data flow showing what data goes where
4. **Recommendations** — Specific changes needed before approval
5. **Monitoring Plan** — What to watch after deployment

## Output

Deliver:
- Security review report (markdown or Google Doc)
- Risk scorecard with dimension breakdowns
- Remediation checklist with prioritized fixes
- Recommended MCP server configuration with minimal permissions
