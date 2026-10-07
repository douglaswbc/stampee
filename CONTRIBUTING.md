# Contributing to Stampfy

Thanks for your interest in contributing.

## Getting started

1. Fork the repo and clone it locally.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local` and fill in your Supabase credentials.
4. Run the app: `npm run dev`

## Submitting changes

- Open an issue first to discuss larger changes.
- Keep PRs focused; one feature or fix per PR when possible.
- Ensure the app still builds: `npm run build`

## Code style

- Use the existing patterns in the codebase (React, TypeScript, Tailwind).
- No need to run a separate formatter unless the project adds one; match surrounding style.

## Security

- Do not commit `.env`, `.env.local`, or any file containing secrets.
- The demo workspace uses a known demo account (documented in the app) for local/dev use only; do not enable it with production Supabase without understanding the implications.
