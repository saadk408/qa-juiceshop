# Test Strategy: OWASP Juice Shop QA Automation Suite

> **Owner:** [YOUR NAME] · **Last updated:** [YYYY-MM-DD] · **Status:** Living document

This document explains *what* I test, *what I deliberately do not test*, and *why*. The automation in this repo executes the decisions made here. If you only read one file to understand my approach to quality, read this one.

A note on framing up front: I built this as a **QA engineer**, not a penetration tester. The security work below is automated regression testing of known vulnerability classes, run against my own local instance. It demonstrates security-aware quality engineering, not offensive security.

---

## 1. The application under test

OWASP Juice Shop is a deliberately insecure e-commerce application (browse, register, log in, basket, checkout, reviews) maintained by the OWASP Foundation as a training target. I chose it because it is a genuinely full-stack system, which lets me show UI, API, and database testing against one coherent application rather than three disconnected demos.

Architecture relevant to testing:

- **Frontend:** Angular single-page application.
- **Backend:** Node.js and Express, exposing a REST API.
- **Data:** a relational database, reseeded on startup.
- **Other:** WebSocket notifications and OAuth login.

Three behaviors of this specific app shaped my design, and I treat each as a deliberate decision rather than an inconvenience:

1. **Self-healing reseed.** The app wipes and repopulates its data from scratch on every server start.
2. **Single-user-per-instance.** One running instance is intended for one user at a time; shared state (including progress tracking) corrupts if multiple actors hit the same instance.
3. **Container safety.** The genuinely dangerous challenges (XXE, server-side template injection, deserialization, some NoSQL injection) are automatically disabled when the app detects a containerized environment.

How I handle all three is covered in Section 5.

---

## 2. Goals and non-goals

**Goals**

- Validate the core commerce journeys across UI, API, and database layers.
- Prove end-to-end data integrity: when the UI says an action succeeded, confirm the API agrees and the database actually persisted it.
- Provide automated checks for a curated set of OWASP Top 10 vulnerability classes.
- Run everything in CI on every change, with a published, viewable report.

**Non-goals, and why**

- **Not a full security audit or pentest.** I cover a representative, safe subset, not the entire vulnerability catalog. Claiming otherwise would misrepresent the scope and my role.
- **No load or performance testing.** The single-user design makes concurrency-based performance results meaningless, so measuring them here would be misleading.
- **Not chasing 100 percent challenge completion.** Volume of solved challenges is not the point. Coverage of *risk* is.
- **No testing of the deliberately dangerous challenges.** They are disabled in a container by design, and exercising them adds risk without adding signal.

Stating these boundaries is intentional. Knowing what *not* to test, and being able to defend it, is part of the job.

---

## 3. Test approach

The approach is **risk-based and layered**. Priority follows the risk matrix in Section 6, not feature convenience.

Layering follows the test pyramid, adapted for this app:

- **API tests carry most of the coverage.** They are fast, stable, and close to the logic, so the bulk of functional assertions live here.
- **UI end-to-end tests are reserved for critical user journeys** where the rendered experience itself is the risk (login, checkout). I keep these focused because they are the slowest and most fragile layer.
- **Database checks confirm persistence and consistency** behind the UI and API.
- **Security regression** covers the curated vulnerability set (Section 8).
- **A DAST baseline scan** runs in CI as a safety net for issues the targeted tests do not cover.

Alongside the automated suite, I run **structured exploratory sessions** using charters (a documented goal, a timebox, and notes). Anything interesting a session surfaces becomes either a logged bug or a new automated case. Exploration finds what scripted tests are not looking for; automation guards what exploration already found.

---

## 4. Coverage by layer

| Layer | Tooling | What it covers |
|-------|---------|----------------|
| UI end-to-end | Playwright + Page Object Model | Register and login, product browse and search, basket, checkout, review submission. Happy paths plus key negative and edge cases. |
| API | Playwright request API + Newman (Postman) | Same operations at the service level: status codes, error handling, auth tokens, and response contract validation against Zod schemas. |
| Database | SQL via a Node client | Persistence checks after UI or API actions, plus the three-way consistency check below. |
| Security regression | Playwright | The curated vulnerability set in Section 8. |
| DAST | OWASP ZAP baseline | Automated passive and baseline active scan of the running app in CI. |

**The three-way consistency check** is the layer most functional portfolios miss: after a write action, I confirm the UI reflects it, the API returns it, and the database stored it correctly. Agreement across all three is what proves I understand the full stack rather than just clicking the surface.

---

## 5. Environment and test data strategy

This section is specific to Juice Shop and is where most of the real judgment lives.

**Self-healing reseed, treated as a determinism gift.** Because every server start gives a clean, known database, I launch a fresh container per CI run. That means every run starts from identical, documented seed data, which is exactly what you want for reproducible tests. The constraint this imposes: no test may assume state survives a restart, and any state a test needs must be created within the test or read from documented seed data.

**Known seed data versus created data.** For read paths I rely on documented seed entities (known products, the seeded admin account). For write paths I create my own data through the API so each test owns its data and stays independent of the others. This keeps tests order-independent and parallel-safe.

**Single-user restriction, handled explicitly.** Because one instance is meant for one user, uncontrolled parallelism against a single instance corrupts shared state. I resolve the speed-versus-isolation tradeoff by defaulting to a fresh container per CI run with modest parallelism, and isolating any test that touches global state (such as the score board). The tradeoff is documented rather than hidden, because the reasoning is the point.

**Container as the safety boundary.** I run only against my own local or CI container, never a shared or remote instance. Running in a container also disables the dangerous challenges automatically, which keeps both the environment and my security scope safe and deterministic.

**Secrets and config.** There are no real secrets. Configuration (base URL, credentials for the seeded accounts, database connection) is supplied via environment variables, with a committed `.env.example` documenting every value.

---

## 6. Risk matrix

Areas are scored on likelihood of a defect and business impact if one ships. Priority drives test depth: P1 areas get UI, API, and database coverage; P3 areas get light or exploratory-only coverage.

| Area | Likelihood | Impact | Priority | Rationale |
|------|-----------|--------|----------|-----------|
| Authentication and session | High | High | **P1** | The gateway to everything; auth defects are both common here and severe. |
| Authorization and access control | High | High | **P1** | Cross-user and admin access failures are high-impact and well-represented in this app. |
| Checkout and basket | Medium | High | **P1** | Directly tied to revenue; a broken checkout is the worst customer-facing failure. |
| Input handling (injection, XSS) | High | High | **P1** | Untrusted input reaches queries and the DOM; high blast radius. |
| API contract conformance | Medium | Medium | **P2** | Silent contract drift breaks clients; cheap to guard at the API layer. |
| Sensitive data exposure | Medium | High | **P2** | Error leakage and exposed files damage trust and aid attackers. |
| Product search and catalog | Medium | Medium | **P2** | Core to the experience but lower severity than money or auth. |
| Reviews and feedback | Medium | Low | **P3** | Useful as an injection surface; low standalone impact. |
| Chatbot and LLM features | Medium | Medium | **P2/P3** | Newer surface (prompt injection); covered as a current, differentiated case. |
| Localization and cosmetic UI | Low | Low | **P3** | Out of automated scope; exploratory only. |

---

## 7. Curated security checks: vulnerabilities and rationale

**The framing that makes this honest.** Because Juice Shop is insecure by design, a test that asserts *secure* behavior will fail against the stock app. I handle this in two deliberate styles, which together mirror how security regression actually enters a real codebase:

- **(A) Vulnerability-confirmation test.** Automate the exploit and assert the insecure behavior is present. This passes against stock Juice Shop and documents the risk with a repeatable check.
- **(B) Target-state spec.** The same scenario written to assert the *secure* behavior, marked as expected-to-fail (using Playwright's `test.fail()` annotation). This represents the regression test I would ship the moment the issue is fixed, at which point it flips to passing.

Pairing the two shows I understand the difference between proving a bug exists and guarding against its return.

The curated set (chosen for being representative of a Top 10 class, safe in a container, and deterministic):

| Vulnerability | OWASP class | Why chosen | What the test asserts |
|---------------|-------------|------------|------------------------|
| SQL injection login bypass | A03 Injection | The canonical injection case; deterministic and safe | (A) An injected credential authenticates as admin. (B) Login rejects the injection and grants no session. |
| Broken access control: admin area and cross-user basket | A01 Broken Access Control | High business impact, easy to reason about | (A) A non-admin reaches admin-only data and one user reads another's basket via the API. (B) Both return 403 or redirect. |
| Cross-site scripting in search or feedback | A03 Injection (XSS) | Representative input-handling flaw, safe in a container | (A) A payload executes or is stored unescaped. (B) The payload is encoded and never executes. |
| Sensitive data exposure via error leakage | A05 / A02 | Shows understanding of information disclosure | (A) An error response leaks stack traces or SQL detail. (B) Errors return a safe, generic message. |
| Broken authentication (weak credential or token handling) | A07 | Auth is the top-priority risk area | (A) A known weak path succeeds. (B) The secure control rejects it. |
| Chatbot prompt injection (optional, current) | LLM-specific | Differentiated, ties to AI-aware QA | (A) The chatbot is manipulated past its intended behavior. (B) It refuses or sanitizes the injected instruction. |

---

## 8. Tooling and rationale

| Tool | Role | Why |
|------|------|-----|
| Playwright + TypeScript | UI and API automation | Fast, reliable auto-waiting, built-in tracing and parallelism, strong current demand. |
| Postman / Newman | API collection in CI | Recognizable, keyword-scanned by recruiters, easy to share and run headless. |
| Zod | Response schema validation | Enforces API contracts; catches silent drift the status code alone misses. |
| SQL client (pg or sqlite driver) | Database assertions | Enables the three-way consistency check. |
| OWASP ZAP | DAST baseline | Industry-standard automated scanner; demonstrates security tooling in a pipeline. |
| Docker Compose | Run the app under test | Reproducible, disposable, and the safe environment for security work. |
| GitHub Actions | CI | Runs the suite on every change and publishes results. |
| GitHub Pages | Report hosting | Makes results viewable from a link without cloning the repo. |

---

## 9. CI and reporting

On every push and pull request the pipeline runs lint, then the functional suite in parallel against a fresh container, then the security checks, then the ZAP baseline scan. Artifacts published: the Playwright HTML report (to GitHub Pages, with traces and screenshots on failure) and the ZAP report.

**Build gating.** Functional failures and any new high-severity ZAP alert fail the build. Vulnerability-confirmation tests are informational by nature (they pass *because* the app is vulnerable), so they report but do not gate.

**Flaky test policy.** A test that fails intermittently is quarantined and tracked, not retried into a false green. Knowing a real failure from a flaky one is a core skill, so I treat flakiness as a defect in the test, not noise to suppress.

---

## 10. Metrics and reporting

What I track, and why it matters to a delivery team rather than just to QA:

- **Pass rate and trend** [TODO: current value]. The headline health signal.
- **Flaky rate** [TODO]. Stability of the suite itself; a leading indicator of trust.
- **Defects found, by type and severity** [TODO]. Evidence the suite earns its keep.
- **Risk-area coverage** against Section 6. Confirms effort is going where risk is, not where tests are easy.

Tied to value: the suite exists to enable faster releases with fewer escaped defects, not to accumulate green checkmarks.

---

## 11. AI-assisted workflow

I use AI to accelerate drafting (including Playwright's planner, generator, and healer agents, and LLM-assisted case authoring), and I keep the judgment human. Every AI-generated case is reviewed against the app's real behavior before it enters the suite. Where the AI made a wrong assumption (a mismatched locator, an invented endpoint, an assertion that does not reflect actual behavior), I record the miss and my correction in `docs/ai-validation-log.md`. The point of that log is the differentiator: it shows I can direct AI and catch where it is wrong, which is the skill, not simply that I used it.

---

## 12. Limitations and future work

Stated honestly, because a strategy that claims to cover everything is not credible:

- Coverage is **representative, not exhaustive**. The curated security set is a deliberate subset.
- **No cross-browser matrix yet.** Playwright supports it; it is a candidate next step.
- **Visual regression and accessibility** (axe) are strong candidate lanes not yet included.
- **Performance is intentionally excluded** for the reason in Section 2.
- The security work is **regression testing, not an audit**, and should not be read as one.

[TODO: update this section as the suite grows so the document stays current.]
