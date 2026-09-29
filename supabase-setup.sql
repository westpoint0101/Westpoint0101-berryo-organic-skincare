create extension if not exists pgcrypto;

create type public.order_status as enum (
  'awaiting_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled'
);

create type public.message_status as enum ('queued', 'sent', 'failed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.products (
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

create table public.orders (
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

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  unit_price_ngn numeric(12, 2) not null check (unit_price_ngn >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create table public.shipments (
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

create table public.whatsapp_messages (
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

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger shipments_set_updated_at
before update on public.shipments
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shipments enable row level security;
alter table public.whatsapp_messages enable row level security;

create policy "Anyone can read active products"
on public.products for select
using (is_active = true);

create policy "Customers can read their own orders"
on public.orders for select
using (auth.uid() = customer_id);

create policy "Customers can read their own order items"
on public.order_items for select
using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.order_items.order_id
      and public.orders.customer_id = auth.uid()
  )
);

create policy "Customers can read their own shipments"
on public.shipments for select
using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.shipments.order_id
      and public.orders.customer_id = auth.uid()
  )
);

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
