# Security

DeckDelta is an early-stage browser-only PDF review tool. Treat PDFs as untrusted input and keep your browser and dependencies current. There is no document-upload API and no server-side document storage.

## Reporting

Use GitHub's private vulnerability reporting on this repository if enabled. If it is unavailable, open an issue with a minimal, non-sensitive description asking for a private reporting channel. Do not post confidential PDFs, access credentials, or weaponized documents in public issues.

## Boundaries

- 25 MB and 50-page limits constrain ordinary workloads; they do not guarantee resistance to malicious decompression or rendering workloads
- PDF actions, attachments, links, and form interactions are not executed by the review UI
- Extracted text and filenames are escaped before HTML insertion
- Reports contain no JavaScript and use a restrictive CSP; they still contain document content and must be shared carefully
- Browser extensions, host integrity, and device security are outside this application's control
- No equivalence, legal, financial, or security assurance is provided by a comparison result
