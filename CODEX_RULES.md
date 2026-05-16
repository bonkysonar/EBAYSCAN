# Codex Rules

- Start new work from `origin/main` on a feature branch when this is a Git repo. If there is no Git repo yet, say so before proceeding.
- Do not deploy unless David explicitly asks.
- Do not commit secrets, API keys, tokens, `.env` files, or private data.
- Do not use scraping as the default approach.
- Prefer official APIs, documented endpoints, and local test mocks.
- Do not build anything that violates eBay API terms or Discogs terms.
- Do not mutate production data unless David explicitly asks.
- Do not create destructive migrations or schema changes without explaining the impact first.
- Before large changes, summarize the plan briefly.
- After changes, summarize exactly what changed, what files were touched, and how to test it.
- Keep API logic, scoring logic, storage, and UI state separated.
- Build for maintainability; spaghetti is for dinner, not code.

## Future Session Startup

Read these files first if present: `PROJECT_BRIEF.md`, `DATA_MODEL.md`, `DECISIONS.md`, `CODEX_RULES.md`, `TEST_PLAN.md`, `README.md`, `.env.example`, and `package.json`.
