# Engineering constraints

- In Vanilla TypeScript UI, never rebuild the whole application DOM for each `input` event. Text controls must naturally retain focus, caret/selection, and IME composition.
- Validate interactive changes with browser E2E tests; unit tests and screenshots alone are insufficient.
- Keep Candidate Pool and Displayed Results as separate state layers; search never changes the probability denominator.
- Seed data is not the complete production corpus. Do not hard-code a Wisp in production code or invent missing records/concept dictionaries for tests.
- Put temporary screenshots, traces, and visual-check output in ignored `artifacts/`; never commit them.
- Do not change product rules merely to pass tests. When the user approves a product behavior change, update both `SPEC.md` and acceptance tests.
- When fixing a bug, audit adjacent controls and modules for the same error pattern rather than patching only the reported instance.
