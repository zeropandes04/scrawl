# Code Review

Perform a comprehensive code review. Be thorough but concise.

Check for:
- Logging — no console.log, proper logger with context
- Error handling — try-catch for async, centralized handlers, helpful messages
- TypeScript — no `any` types, proper interfaces, no @ts-ignore
- Production readiness — no debug statements, no TODOs, no hardcoded secrets
- React/Hooks — effects have cleanup, dependencies complete, no infinite loops
- Performance — no unnecessary re-renders, expensive calcs memoized
- Security — auth checked, inputs validated
- Architecture — follows existing patterns, code in correct directory

Output format:
### ✅ Looks Good
### ⚠️ Issues Found
- **[CRITICAL/HIGH/MEDIUM/LOW]** [File:line] — [Issue] → Fix: [suggestion]
### 📊 Summary
- Files reviewed: X | Critical: X | Warnings: X