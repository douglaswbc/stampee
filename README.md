<div align="center">
<img width="1200" alt="Stampfy preview" src="public/image_1.jpg" />
</div>

# Stampfy

Stampfy is a digital loyalty and stamp card platform. Each owner account manages one business, with its data isolated in Supabase. An institutional website module for each business is in implementation. You can self-host the frontend and connect it to your own Supabase project.

Owners can register a business at `/signup` and sign in at `/login`. Each owner account is one tenant in the current SaaS model. Platform administrators use the separate `/platform` console; staff sign in through `/{slug}/staff`; customers can join a campaign at `/{slug}/join/{campaignId}` and view a card at `/{slug}/{uniqueId}`.

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
   In PowerShell, use `Copy-Item .env.example .env.local`.

3. Configure `.env.local`:

   Required:
   - `VITE_APP_URL`: your app URL, for example `http://localhost:3000` for local development
   - `VITE_SUPABASE_URL`: your [Supabase](https://supabase.com) project URL
   - `VITE_SUPABASE_ANON_KEY`: your Supabase anon key

   Optional:
   - `VITE_ENABLE_DEMO_WORKSPACE`: set to `true` to enable the demo workspace in development
   - `VITE_SUPPORT_EMAIL`: support email shown in the app

4. Set up the database in the Supabase SQL Editor:
   ```text
   supabase/migration.sql   -> run first for a fresh install
   supabase/seed.sql        -> optional, run second for local/dev demo and platform accounts
   ```

   Notes:
   - [`supabase/migration.sql`](supabase/migration.sql) is the canonical fresh-install script. It includes the current schema, RLS policies, storage policies, and RPC functions.
   - The smaller SQL files in [`supabase/legacy-patches/`](supabase/legacy-patches/) are upgrade or repair scripts for older or existing projects and are not part of the default new-project setup.
   - For an existing project, run [`supabase/legacy-patches/add_loyalty_missions.sql`](supabase/legacy-patches/add_loyalty_missions.sql) before deploying the matching application version. The patch adds the mission schema and secure RPCs; the current app continues to work while the deployment is prepared.
   - After the mission patch, run [`supabase/legacy-patches/add_loyalty_points.sql`](supabase/legacy-patches/add_loyalty_points.sql) in the SQL Editor before deploying the points and levels interface. It adds the immutable points ledger, configurable levels, audited owner adjustments, milestone badges, and the public-card summary RPC.
   - With the Supabase CLI logged in and this project linked, the same patch can be applied without Docker using `npx supabase db query --linked --file supabase/legacy-patches/add_loyalty_points.sql`.
   - For the reward catalog and redemption codes, run [`supabase/legacy-patches/add_loyalty_rewards.sql`](supabase/legacy-patches/add_loyalty_rewards.sql) after the points patch. It adds reward offers, stock and eligibility rules, customer claims, expiring unique codes, staff validation, owner cancellation/refunds, and an audit trail. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/add_loyalty_rewards.sql`.
   - To let mission completions unlock rewards from the shared catalog, run [`supabase/legacy-patches/link_mission_rewards_to_catalog.sql`](supabase/legacy-patches/link_mission_rewards_to_catalog.sql) after the missions, points, and reward catalog patches. Customers then claim a code on their public card, while stock, expiry, validation, and redemption history use the existing reward flow. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/link_mission_rewards_to_catalog.sql`.
   - To enable the owner-only “Reset business data” control in Settings on an existing project, run [`supabase/legacy-patches/reset_owner_business_data.sql`](supabase/legacy-patches/reset_owner_business_data.sql). It clears operational records while preserving owner/staff access and company preferences. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/reset_owner_business_data.sql`.
   - For an existing project, also run [`supabase/legacy-patches/add_company_locale_preferences.sql`](supabase/legacy-patches/add_company_locale_preferences.sql) to persist the company's interface language and currency preferences.
   - To persist the company's time zone, run [`supabase/legacy-patches/add_company_time_zone.sql`](supabase/legacy-patches/add_company_time_zone.sql) before deploying the time zone settings. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/add_company_time_zone.sql`.
   - For the institutional website module, apply [`supabase/legacy-patches/add_business_sites.sql`](supabase/legacy-patches/add_business_sites.sql) before deploying. It adds tenant-scoped drafts, publication history, and public read RPCs. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `APP_ORIGIN` in Vercel; see [the website module plan](docs/sites-institucionais.md) for sitemap and routing details.
   - For welcome points and customer referrals, run [`supabase/legacy-patches/add_customer_welcome_and_referral_points.sql`](supabase/legacy-patches/add_customer_welcome_and_referral_points.sql) after the points and reward catalog patches. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/add_customer_welcome_and_referral_points.sql`.
   - For an existing project, apply [`supabase/legacy-patches/add_saas_platform_foundation.sql`](supabase/legacy-patches/add_saas_platform_foundation.sql) to add the platform admin registry and tenant management RPCs. Apply it without Docker with `npx supabase db query --linked --file supabase/legacy-patches/add_saas_platform_foundation.sql`.
   - The development seed creates a local platform administrator. For production, create an Auth user with a unique password first, set its email in [`supabase/bootstrap_platform_admin.sql`](supabase/bootstrap_platform_admin.sql), then run that bootstrap in the SQL Editor.
   - [`supabase/seed.sql`](supabase/seed.sql) is for local or development environments only because it creates a known demo account.

5. Start the dev server:
   ```bash
   npm run dev
   ```

## Development Seed Accounts

If you run [`supabase/seed.sql`](supabase/seed.sql), it creates this development-only owner account:

| Field | Value |
|---|---|
| Email | `admin@stampfy.local` |
| Password | `Admin1234` |
| Slug | `demo` |

The same seed also creates a development-only platform administrator:

| Field | Value |
|---|---|
| Email | `platform@stampfy.local` |
| Password | `PlatformAdmin123!` |

These known credentials are for local development only. Never use them in production.

Change the demo business password after first login in `Settings -> Account`. Use `/forgot-password` to change the platform account password.

Do not use the demo seed account as-is in production.

## Available Scripts

- `npm run dev`: start the Vite development server
- `npm run generate:sitemap`: regenerate `public/sitemap.xml`
- `npm run build`: regenerate the sitemap, then build the production bundle
- `npm run preview`: preview the production build locally

There is currently no automated test suite in the repo. `npm run build` is the main verification step for this project today.

## Product Notes

- Each owner account manages one business; business data and staff access are isolated by owner.
- Public business signup is available at `/signup`; each owner profile currently represents one tenant.
- The platform console is restricted to user IDs registered in `platform_admins`; its role is separate from tenant owners.
- The tenant console currently supports listing businesses and suspending/restoring access. Billing and multi-user business memberships are future SaaS work.
- See the [SaaS foundation notes](docs/saas-foundation.md) for the current tenant model and the next platform steps.
- Staff accounts are created by the owner from `Settings -> Staff`
- Public customer routes support campaign enrollment, digital cards, mission progress, points, referrals, and reward redemption.
- A public institutional site and product/service directory are planned, not implemented. See the [institutional site module plan](docs/sites-institucionais.md).

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
