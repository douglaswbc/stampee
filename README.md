<div align="center">
<img width="1200" alt="Stampfy preview" src="public/image_1.jpg" />
</div>

# Stampfy

Stampfy is a digital loyalty card and stamp card app for a single business. You can self-host the frontend and connect it to your own Supabase project.

All access starts at `/login`. There is no marketplace or multi-tenant public signup flow for businesses.

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Radix UI primitives
- React Router
- Supabase Auth, Postgres, Storage, and RPC functions
- Vercel Analytics
- Vercel deployment config via [`vercel.json`](vercel.json)

## Prerequisites

- Node.js
- A Supabase project

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment template:
   ```bash
   cp .env.example .env.local
   ```

3. Configure `.env.local`:

   Required:
   - `VITE_APP_URL`: your app URL, for example `http://localhost:5173`
   - `VITE_SUPABASE_URL`: your [Supabase](https://supabase.com) project URL
   - `VITE_SUPABASE_ANON_KEY`: your Supabase anon key

   Optional:
   - `VITE_ENABLE_DEMO_WORKSPACE`: set to `true` to enable the demo workspace in development
   - `VITE_SUPPORT_EMAIL`: support email shown in the app

4. Set up the database in the Supabase SQL Editor:
   ```text
   supabase/migration.sql   -> run first for a fresh install
   supabase/seed.sql        -> optional, run second for the local/dev demo admin
   ```

   Notes:
   - [`supabase/migration.sql`](supabase/migration.sql) is the canonical fresh-install script. It includes the current schema, RLS policies, storage policies, and RPC functions.
   - The smaller SQL files in [`supabase/legacy-patches/`](supabase/legacy-patches/) are upgrade or repair scripts for older or existing projects and are not part of the default new-project setup.
   - For an existing project, run [`supabase/legacy-patches/add_loyalty_missions.sql`](supabase/legacy-patches/add_loyalty_missions.sql) before deploying the matching application version. The patch adds the mission schema and secure RPCs; the current app continues to work while the deployment is prepared.
   - After the mission patch, run [`supabase/legacy-patches/add_loyalty_points.sql`](supabase/legacy-patches/add_loyalty_points.sql) in the SQL Editor before deploying the points and levels interface. It adds the immutable points ledger, configurable levels, audited owner adjustments, milestone badges, and the public-card summary RPC.
   - With the Supabase CLI logged in and this project linked, the same patch can be applied without Docker using `npx supabase db query --linked --file supabase/legacy-patches/add_loyalty_points.sql`.
   - For the reward catalog and redemption codes, run [`supabase/legacy-patches/add_loyalty_rewards.sql`](supabase/legacy-patches/add_loyalty_rewards.sql) after the points patch. It adds reward offers, stock and eligibility rules, customer claims, expiring unique codes, staff validation, owner cancellation/refunds, and an audit trail. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/add_loyalty_rewards.sql`.
   - For an existing project, also run [`supabase/legacy-patches/add_company_locale_preferences.sql`](supabase/legacy-patches/add_company_locale_preferences.sql) to persist the company's interface language and currency preferences.
   - [`supabase/seed.sql`](supabase/seed.sql) is for local or development environments only because it creates a known demo account.

5. Start the dev server:
   ```bash
   npm run dev
   ```

## Demo Admin Seed

If you run [`supabase/seed.sql`](supabase/seed.sql), it creates this development-only owner account:

| Field | Value |
|---|---|
| Email | `admin@stampfy.local` |
| Password | `Admin1234` |
| Slug | `demo` |

Change the password after first login in `Settings -> Account`.

Do not use the demo seed account as-is in production.

## Available Scripts

- `npm run dev`: start the Vite development server
- `npm run generate:sitemap`: regenerate `public/sitemap.xml`
- `npm run build`: regenerate the sitemap, then build the production bundle
- `npm run preview`: preview the production build locally

There is currently no automated test suite in the repo. `npm run build` is the main verification step for this project today.

## Product Notes

- Single-business mode only
- No public business signup flow
- Staff accounts are created by the owner from `Settings -> Staff`
- Public customer-facing routes are supported for viewing issued cards and joining enabled campaigns

## Deploy

You can deploy the app anywhere that serves a Vite SPA, including Vercel.

1. Add the same `VITE_...` environment variables to your deployment platform.
2. If you use Vercel, you can optionally enable Vercel Web Analytics.
3. [`vercel.json`](vercel.json) already rewrites client-side routes to `index.html`.
4. Make sure your Supabase project has already been initialized with [`supabase/migration.sql`](supabase/migration.sql).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](LICENSE)
