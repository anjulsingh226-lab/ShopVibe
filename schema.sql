-- STORE SETUP: Supabase SQL Editor me poora ek baar Run karo (dobara run karne se bhi koi dikkat nahi)
create extension if not exists pgcrypto;
create table if not exists products(
  id uuid primary key default gen_random_uuid(),
  name text not null, price numeric not null default 0, mrp numeric,
  description text, category text, image_url text,
  in_stock boolean not null default true,
  created_at timestamptz default now());
create table if not exists settings(key text primary key, value text);
alter table products enable row level security;
alter table settings enable row level security;
insert into settings(key,value) values
  ('site_name','My Store'),('hero_title','Welcome to our store'),
  ('hero_subtitle','Best products at the best price'),('hero_cta','Shop Now'),
  ('hero_image',''),('logo_url',''),('whatsapp',''),('footer_text','All rights reserved')
on conflict (key) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store','store',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
update storage.buckets set public = true where id = 'store';
