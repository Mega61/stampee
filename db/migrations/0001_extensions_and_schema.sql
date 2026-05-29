-- ============================================================
-- 0001_extensions_and_schema.sql
-- Base extensions and the `loyalty` schema.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists loyalty;

-- All subsequent migrations assume this search_path during their own execution.
-- It does NOT persist across sessions; the API sets it per-connection.
set search_path = loyalty, public;
