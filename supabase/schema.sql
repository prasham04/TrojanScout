-- Run in the Supabase SQL editor (one project for both services).
create extension if not exists postgis;
create extension if not exists vector;

create table if not exists listings (
  id serial primary key, address text not null, rent int not null, beds int,
  lat double precision not null, lng double precision not null, url text, utilities_est int
);
create table if not exists buildings (
  id serial primary key, name text not null, code text, lat double precision not null, lng double precision not null
);
create table if not exists zones (
  name text primary key, geojson jsonb not null, last_verified date
);
create table if not exists listing_cache (
  listing_id int primary key references listings(id) on delete cascade,
  zones jsonb, commute jsonb, block jsonb, updated_at timestamptz default now()
);

-- AI service (FastAPI) tables
create table if not exists chunks (
  id bigserial primary key, text text not null, embedding vector(384),
  lat double precision, lng double precision,
  geog geography(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  source text, url text, date date, category text
);
create index if not exists chunks_geog_idx on chunks using gist (geog);
create index if not exists chunks_emb_idx on chunks using hnsw (embedding vector_cosine_ops);

create table if not exists incidents (
  id bigserial primary key, lat double precision, lng double precision,
  geog geography(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  date date, category text, source text
);
create index if not exists incidents_geog_idx on incidents using gist (geog);

-- Geo-filtered vector search with recency boost
create or replace function match_chunks(query_emb vector(384), lat double precision, lng double precision,
                                        radius_m double precision, k int)
returns table (id bigint, text text, source text, url text, date date, category text, similarity double precision)
language sql stable as $$
  select c.id, c.text, c.source, c.url, c.date, c.category,
         (1 - (c.embedding <=> query_emb))
           * (1 + 0.2 * exp(-greatest(current_date - coalesce(c.date, current_date - 365), 0) / 180.0)) as similarity
  from chunks c
  where st_dwithin(c.geog, st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_m)
  order by similarity desc
  limit k;
$$;
