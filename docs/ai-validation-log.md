# AI Validation Log

AI accelerates drafting in this repo; judgment stays human. Every AI-generated
case is checked against the application's real behavior before it enters the
suite. This log records where the AI got something wrong and how I corrected it.
The point is the differentiator: directing AI and catching its mistakes is the
skill, not simply using it.

| Date | Area / file | What the AI got wrong | The correction | Lesson |
|------|-------------|-----------------------|----------------|--------|
| YYYY-MM-DD | `src/fixtures/auth.ts`, security cases | Drafted helpers that logged in as a hardcoded seeded account (`jim@juice-sh.op`) and assumed stable seeded IDs. | Switched to registering a fresh, unique user per test via `POST /api/Users`, so nothing depends on a seeded password that can change between Juice Shop versions. | Seeded credentials are a hidden coupling; per-test data is more robust and reads better. |
| YYYY-MM-DD | `tests/security/chatbot-prompt-injection.spec.ts` | Used `page.waitForTimeout(1500)` to pace chatbot turns. | Replaced fixed sleeps with a wait on the chatbot's response, so the case is deterministic rather than timing-dependent. | Fixed sleeps are flake waiting to happen; wait on real signals. |
| YYYY-MM-DD | `docker-compose.yml` / db layer | Suggested bind-mounting Juice Shop's data directory to read the SQLite file. | Rejected: the mount shadows seed files the app needs at boot. The db fixture copies the file out with `docker compose cp` instead. | Verify a proposed approach against how the app actually starts, not just whether it compiles. |

> Replace the placeholder dates with the real ones as you validate each case, and
> add a row whenever the AI's first draft missed the app's real behavior.
