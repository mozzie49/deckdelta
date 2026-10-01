# Contributing

Use Node.js 24+, run `npm ci`, then `npm run check`. UI changes should also pass `npm run test:e2e` after installing Playwright Chromium.

Keep the application static and local-first. Never add document uploads, analytics, remote fonts, or runtime CDN dependencies without an explicit design discussion. Avoid increasing what “No change detected” promises.

For matching changes, add a small adversarial test covering order, duplicates, additions/deletions, and uncertainty. Never tune a threshold only to make the demo look good. Pairing must represent every page exactly once, and manual corrections must preserve that invariant.

For UI changes, test cancellation, repeated/replaced uploads, manual correction, review-state invalidation, keyboard navigation, mobile overflow, both languages, and the standalone export.

Only contribute PDFs and images you have the right to share. Use fictional or synthetic fixtures. No confidential decks in issues or pull requests.
