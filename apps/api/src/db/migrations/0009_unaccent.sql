-- Accent- and case-insensitive member search (Greek tonos included). unaccent is a trusted
-- extension, so the database owner (gym_owner, running migrations) may create it.
CREATE EXTENSION IF NOT EXISTS unaccent;
