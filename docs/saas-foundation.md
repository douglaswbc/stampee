# Stampfy SaaS foundation

## Tenant boundary

The initial SaaS model uses one authenticated `owner` profile per business. That profile ID is the tenant key stored as `owner_id` on campaigns, customers, cards, transactions, missions, rewards, and other business records. Existing RLS policies isolate each tenant by this key. A staff profile belongs to the same tenant through its `owner_id`.

This keeps the current product compatible while allowing independent businesses to register at `/signup`. It does not yet support multiple owners, administrators, or branches within one business.

## Platform administration

`platform_admin` is a platform-level role, separate from business `owner` and `staff` roles. The role on `profiles` controls the application route, while `platform_admins` is the private authorization registry used by platform RPCs. User-editable Auth metadata and direct profile updates cannot grant platform privileges.

The `/platform` console lists business tenants and can suspend or restore tenant access. A restrictive RLS policy checks the tenant access state on tables with `owner_id`, so suspension applies to direct authenticated table access as well as the application UI.

## Provisioning

- Local development: run `supabase/migration.sql`, then `supabase/seed.sql`. The seed contains known local-only credentials for a demo business and a platform administrator.
- Production: do not run the development seed. Create a real Auth user with a unique password, set its email in `supabase/bootstrap_platform_admin.sql`, and run that script in the Supabase SQL Editor.
- Business onboarding: owners register through `/signup`; the database creates an owner profile, which becomes the business tenant boundary.

## SaaS work still ahead

- Introduce explicit organizations and memberships if a business needs multiple owners/admins or locations. Migrate `owner_id` only after every RLS policy, RPC, and storage rule has a tested mapping.
- Replace the current `free`/`pro` labels and unlimited beta limits with defined plans, usage enforcement, billing, and subscription lifecycle handling.
- Add tenant invitations, support workflows, audit history for platform actions, and account deletion/export policies.
