# PostgreSQL / Supabase readiness

The backend already uses SQLAlchemy and accepts `DATABASE_URL`; local SQLite remains the default. `backend/migrations/versions/0001_initial_schema.py` is the initial Alembic schema for a new PostgreSQL database. It creates `delivery_runs`, `delivery_stops`, and `activities` with their foreign keys and indexes. OTP values remain stored only on the backend stop row and are not part of delivery response schemas.

## Prepare a new Supabase database

1. Create a Supabase project and use its PostgreSQL connection string in the backend environment only.
2. Set `DATABASE_URL=postgresql+psycopg://...` in `backend/.env` (or `postgresql://...`; Alembic and the runtime normalize it to psycopg).
3. From `backend`, run `python -m alembic upgrade head`.
4. Start the API and verify `/api/health`, delivery counts, and OTP completion against a authorized staging run.

Keep the Supabase service/database credential out of all `VITE_*` variables and browser code. Restrict database network access and rotate credentials if they have been shared.

## Existing SQLite data

No cloud migration has been run. Back up the SQLite file, compare its tables/columns/indexes with this revision, then use a reviewed data-transfer procedure that preserves IDs, statuses, activity timestamps, relationships, and the backend-only OTP values. Verify row counts, foreign keys, and a correct/incorrect OTP completion against a staging project before switching `DATABASE_URL`. Do not run `alembic upgrade head` against an existing populated schema without first determining whether it needs `stamp head` or a bespoke bridge revision; the initial revision intentionally creates fresh tables and is not a data migration.

The current application startup still invokes `Base.metadata.create_all()` and a SQLite-specific compatibility column updater. Production rollout should first move schema changes to Alembic and disable automatic schema mutation once all existing databases are baselined. A safe, repeatable SQLite-to-PostgreSQL data-copy command and production database verification are still needed before a real cutover.

