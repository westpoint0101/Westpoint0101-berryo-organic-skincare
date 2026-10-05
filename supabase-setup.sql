create extension if not exists pgcrypto;

do $$
begin
  create type public.order_status as enum (
    'awaiting_payment',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.message_status as enum ('queued', 'sent', 'failed');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

drop policy if exists "Customers can read their own profile" on public.profiles;
create policy "Customers can read their own profile"
on public.profiles for select
using (auth.uid() = id);
grant select on public.profiles to authenticated;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category text not null,
  description text not null default '',
  ingredients text not null default '',
  benefits text[] not null default '{}',
  image_url text,
  price_ngn numeric(12, 2) not null check (price_ngn >= 0),
  price_usd numeric(12, 2),
  size text,
  sku text unique,
  inventory_count integer not null default 0 check (inventory_count >= 0),
  is_active boolean not null default true,
  featured boolean not null default false,
  bestseller boolean not null default false,
  new_arrival boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  customer_id uuid references auth.users (id) on delete set null,
  customer_name text not null,
  customer_email text,
  customer_phone text not null,
  delivery_address text not null,
  delivery_city text,
  delivery_country text,
  shipping_fee_ngn numeric(12, 2) not null default 0 check (shipping_fee_ngn >= 0),
  subtotal_ngn numeric(12, 2) not null check (subtotal_ngn >= 0),
  total_ngn numeric(12, 2) not null check (total_ngn >= 0),
  payment_method text not null default 'whatsapp',
  status public.order_status not null default 'awaiting_payment',
  tracking_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  unit_price_ngn numeric(12, 2) not null check (unit_price_ngn >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references public.orders (id) on delete cascade,
  carrier text,
  tracking_number text,
  status text not null default 'pending',
  latest_update text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  recipient_phone text not null,
  message_type text not null,
  body text not null,
  status public.message_status not null default 'queued',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
before update on public.shipments
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shipments enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists "Anyone can read active products" on public.products;
create policy "Anyone can read active products"
on public.products for select
using (is_active = true);
grant select on public.products to anon, authenticated;

drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
on public.orders for select
using (auth.uid() = customer_id);

drop policy if exists "Customers can read their own order items" on public.order_items;
create policy "Customers can read their own order items"
on public.order_items for select
using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.order_items.order_id
      and public.orders.customer_id = auth.uid()
  )
);

drop policy if exists "Customers can read their own shipments" on public.shipments;
create policy "Customers can read their own shipments"
on public.shipments for select
using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.shipments.order_id
      and public.orders.customer_id = auth.uid()
  )
);

drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products"
on public.products for all
using (
  exists (
    select 1 from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.is_admin = true
  )
);

drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders"
on public.orders for all
using (
  exists (
    select 1 from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.is_admin = true
  )
);

insert into public.products (
  slug, name, category, description, image_url, price_ngn, size, sku,
  inventory_count, is_active, featured
)
values
  ('dark-knuckle-cream-100ml', 'Dark Knuckle Cream (100ml)', 'Body Care', 'Dark Knuckle Cream from BERRYO Organic Skincare.', './assets/products/dark-knuckle-cream.png', 20000, '100ml', 'BO-001', 100, true, true),
  ('snow-white-black-soap-250g', 'Snow White Black Soap (250g)', 'Soaps', 'Snow White Black Soap from BERRYO Organic Skincare.', './assets/products/snow-white-black-soap.png', 12000, '250g', 'BO-002', 100, true, true),
  ('snow-white-black-soap-500g', 'Snow White Black Soap (500g)', 'Soaps', 'Snow White Black Soap from BERRYO Organic Skincare.', './assets/products/snow-white-black-soap.png', 24000, '500g', 'BO-003', 100, true, true),
  ('snow-white-black-soap-1kg', 'Snow White Black Soap (1kg)', 'Soaps', 'Snow White Black Soap from BERRYO Organic Skincare.', './assets/products/snow-white-black-soap.png', 50000, '1kg', 'BO-004', 100, true, true),
  ('snow-white-black-soap-5kg', 'Snow White Black Soap (5kg)', 'Soaps', 'Snow White Black Soap from BERRYO Organic Skincare.', './assets/products/snow-white-black-soap.png', 160000, '5kg', 'BO-005', 100, true, true),
  ('molato-whitening-soap-250g', 'Molato Whitening Soap (250g)', 'Soaps', 'Molato Whitening Soap from BERRYO Organic Skincare.', './assets/products/molato-whitening-face-body-soap.png', 12000, '250g', 'BO-006', 100, true, false),
  ('molato-whitening-soap-500g', 'Molato Whitening Soap (500g)', 'Soaps', 'Molato Whitening Soap from BERRYO Organic Skincare.', './assets/products/molato-whitening-face-body-soap.png', 25000, '500g', 'BO-007', 100, true, false),
  ('molato-whitening-soap-1kg', 'Molato Whitening Soap (1kg)', 'Soaps', 'Molato Whitening Soap from BERRYO Organic Skincare.', './assets/products/molato-whitening-face-body-soap.png', 50000, '1kg', 'BO-008', 100, true, false),
  ('molato-whitening-soap-5kg', 'Molato Whitening Soap (5kg)', 'Soaps', 'Molato Whitening Soap from BERRYO Organic Skincare.', './assets/products/molato-whitening-face-body-soap.png', 160000, '5kg', 'BO-009', 100, true, false),
  ('snow-white-shower-gel-500ml', 'Snow White Shower Gel (500ml)', 'Body Care', 'Snow White Shower Gel from BERRYO Organic Skincare.', './assets/products/snow-white-shower-gel.png', 12000, '500ml', 'BO-010', 100, true, false),
  ('snow-white-shower-gel-1l', 'Snow White Shower Gel (1 litre)', 'Body Care', 'Snow White Shower Gel from BERRYO Organic Skincare.', './assets/products/snow-white-shower-gel.png', 25000, '1 litre', 'BO-011', 100, true, false),
  ('snow-white-luxury-cream-300ml', 'Snow White Luxury Cream (300ml)', 'Body Care', 'Snow White Luxury Cream from BERRYO Organic Skincare.', './assets/products/snow-white-luxury-cream.png', 30000, '300ml', 'BO-012', 100, true, false),
  ('snow-white-luxury-cream-500ml', 'Snow White Luxury Cream (500ml)', 'Body Care', 'Snow White Luxury Cream from BERRYO Organic Skincare.', './assets/products/snow-white-luxury-cream.png', 60000, '500ml', 'BO-013', 100, true, false),
  ('snow-white-luxury-cream-1l', 'Snow White Luxury Cream (1 litre)', 'Body Care', 'Snow White Luxury Cream from BERRYO Organic Skincare.', './assets/products/snow-white-luxury-cream.png', 120000, '1 litre', 'BO-014', 100, true, false),
  ('half-cast-cream-300ml', 'Half Cast Cream (300ml)', 'Body Care', 'Half Cast Cream from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 30000, '300ml', 'BO-015', 100, true, false),
  ('half-cast-cream-500ml', 'Half Cast Cream (500ml)', 'Body Care', 'Half Cast Cream from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 60000, '500ml', 'BO-016', 100, true, false),
  ('half-cast-cream-1l', 'Half Cast Cream (1 litre)', 'Body Care', 'Half Cast Cream from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 120000, '1 litre', 'BO-017', 100, true, false),
  ('face-cleanser-120ml', 'Face Cleanser (120ml)', 'Face Care', 'Face Cleanser from BERRYO Organic Skincare.', './assets/products/face-cleanser.png', 8000, '120ml', 'BO-018', 100, true, false),
  ('whitening-glowing-oil-100ml', 'Whitening & Glowing Oil (100ml)', 'Body Care', 'Whitening & Glowing Oil from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 12000, '100ml', 'BO-019', 100, true, false),
  ('whitening-glowing-oil-200ml', 'Whitening & Glowing Oil (200ml)', 'Body Care', 'Whitening & Glowing Oil from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 25000, '200ml', 'BO-020', 100, true, false),
  ('whitening-glowing-oil-500ml', 'Whitening & Glowing Oil (500ml)', 'Body Care', 'Whitening & Glowing Oil from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 50000, '500ml', 'BO-021', 100, true, false),
  ('whitening-glowing-oil-1l', 'Whitening & Glowing Oil (1 litre)', 'Body Care', 'Whitening & Glowing Oil from BERRYO Organic Skincare.', './assets/products/whitening-face-skin.png', 150000, '1 litre', 'BO-022', 100, true, false),
  ('face-cream-100g', 'Face Cream (100g)', 'Face Care', 'Face Cream from BERRYO Organic Skincare.', './assets/products/face-creams-duo.png', 20000, '100g', 'BO-023', 100, true, false),
  ('face-cream-150g', 'Face Cream (150g)', 'Face Care', 'Face Cream from BERRYO Organic Skincare.', './assets/products/face-creams-duo.png', 25000, '150g', 'BO-024', 100, true, false),
  ('pink-lips-10g', 'Pink Lips (10g)', 'Lip Care', 'Pink Lips from BERRYO Organic Skincare.', './assets/products/lip-balm.png', 5000, '10g', 'BO-025', 100, true, false),
  ('pink-lips-20g', 'Pink Lips (20g)', 'Lip Care', 'Pink Lips from BERRYO Organic Skincare.', './assets/products/lip-balm.png', 7000, '20g', 'BO-026', 100, true, false),
  ('turmeric-lightening-body-scrub-250g', 'Turmeric Lightening Body Scrub (250g)', 'Body Care', 'Turmeric Lightening Body Scrub from BERRYO Organic Skincare.', './assets/products/turmeric-lightening-body-scrub.png', 12000, '250g', 'BO-027', 100, true, false),
  ('turmeric-lightening-body-scrub-500g', 'Turmeric Lightening Body Scrub (500g)', 'Body Care', 'Turmeric Lightening Body Scrub from BERRYO Organic Skincare.', './assets/products/turmeric-lightening-body-scrub.png', 24000, '500g', 'BO-028', 100, true, false),
  ('turmeric-lightening-body-scrub-1l', 'Turmeric Lightening Body Scrub (1 litre)', 'Body Care', 'Turmeric Lightening Body Scrub from BERRYO Organic Skincare.', './assets/products/turmeric-lightening-body-scrub.png', 50000, '1 litre', 'BO-029', 100, true, false)
on conflict (slug) do nothing;

create or replace function public.create_customer_order(
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order_id uuid;
  v_order_code text;
  v_item_count integer;
  v_matching_item_count integer;
  v_subtotal numeric(12, 2);
  v_shipping_fee numeric(12, 2) := 1800;
begin
  if v_customer_id is null then
    raise exception 'Sign in before placing an order.';
  end if;

  if coalesce(length(trim(p_customer_name)), 0) not between 1 and 160
    or coalesce(length(trim(p_customer_phone)), 0) not between 7 and 40
    or coalesce(length(trim(p_delivery_address)), 0) not between 5 and 1000 then
    raise exception 'Enter a valid name, phone number, and delivery address.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be provided as a list.';
  end if;

  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'An order must contain between 1 and 50 items.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(slug text, quantity integer)
    where requested.slug is null
      or requested.quantity is null
      or requested.quantity not between 1 and 99
  ) then
    raise exception 'Each item must have a product slug and quantity between 1 and 99.';
  end if;

  perform product.id
  from public.products as product
  join jsonb_to_recordset(p_items) as requested(slug text, quantity integer)
    on product.slug = requested.slug
  order by product.id
  for share of product;

  select count(*), count(product.id),
    coalesce(sum(product.price_ngn * requested.quantity), 0)
  into v_item_count, v_matching_item_count, v_subtotal
  from jsonb_to_recordset(p_items) as requested(slug text, quantity integer)
  left join public.products as product
    on product.slug = requested.slug and product.is_active = true;

  if v_item_count <> v_matching_item_count then
    raise exception 'One or more products are unavailable. Refresh the store and try again.';
  end if;

  v_order_code := 'BO-' || to_char(now(), 'YYYY') || '-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));

  insert into public.orders (
    order_code, customer_id, customer_name, customer_email, customer_phone,
    delivery_address, shipping_fee_ngn, subtotal_ngn, total_ngn, payment_method, status
  )
  select v_order_code, v_customer_id, trim(p_customer_name), users.email, trim(p_customer_phone),
    trim(p_delivery_address), v_shipping_fee, v_subtotal, v_subtotal + v_shipping_fee,
    'moniepoint_transfer', 'awaiting_payment'
  from auth.users as users
  where users.id = v_customer_id
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The customer account could not be verified.';
  end if;

  insert into public.order_items (order_id, product_id, product_name, unit_price_ngn, quantity)
  select v_order_id, product.id, product.name, product.price_ngn, sum(requested.quantity)::integer
  from jsonb_to_recordset(p_items) as requested(slug text, quantity integer)
  join public.products as product
    on product.slug = requested.slug and product.is_active = true
  group by product.id, product.name, product.price_ngn;

  return jsonb_build_object(
    'order_code', v_order_code,
    'total_ngn', v_subtotal + v_shipping_fee,
    'status', 'awaiting_payment'
  );
end;
$$;

revoke all on function public.create_customer_order(text, text, text, jsonb) from public;
grant execute on function public.create_customer_order(text, text, text, jsonb) to authenticated;

do $$
declare
  v_admin_id uuid;
begin
  select id
  into v_admin_id
  from auth.users
  where lower(email) = lower('berryorganicskincare@gmail.com')
    and email_confirmed_at is not null;

  if v_admin_id is null then
    raise notice 'Store tables and catalog are installed. Verify berryorganicskincare@gmail.com, then run supabase-admin-console-setup.sql to grant admin access.';
  else
    insert into public.profiles (id, full_name, is_admin)
    select v_admin_id, raw_user_meta_data ->> 'full_name', true
    from auth.users
    where id = v_admin_id
    on conflict (id) do update
      set is_admin = true;
  end if;
end;
$$;

notify pgrst, 'reload schema';
