-- Runs once, as the superuser, when the postgres volume is empty.
-- Passwords come from the container environment (see docker-compose.yml / .env), read with psql's \getenv.
-- After editing this file: docker compose down -v && docker compose up -d

\getenv gym_owner_password GYM_OWNER_PASSWORD
\getenv gym_app_password GYM_APP_PASSWORD

-- Owns the databases and runs migrations. BYPASSRLS because it is also systemDb:
-- the paths where no gym is known yet (platform-admin gym creation, token lookups, test seeding).
CREATE ROLE gym_owner LOGIN NOSUPERUSER BYPASSRLS PASSWORD :'gym_owner_password';

-- Runtime role of the API. Never owns tables and never bypasses row-level security.
CREATE ROLE gym_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'gym_app_password';

CREATE DATABASE gym OWNER gym_owner;
CREATE DATABASE gym_test OWNER gym_owner;
