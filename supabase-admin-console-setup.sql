create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.products
  add column if not exists wholesale_price_ngn numeric(12, 2)
    check (wholesale_price_ngn is null or wholesale_price_ngn >= 0),
  add column if not exists wholesale_price_usd numeric(12, 2)
    check (wholesale_price_usd is null or wholesale_price_usd >= 0),
  add column if not exists low_stock_threshold integer not null default 5
    check (low_stock_threshold >= 0);

alter table public.orders
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_reference text,
  add column if not exists payment_proof_path text,
  add column if not exists payment_submitted_at timestamptz;

alter table public.orders
  drop constraint if exists orders_payment_status_check,
  add constraint orders_payment_status_check
    check (payment_status in ('pending', 'submitted', 'paid', 'failed', 'refunded'));

update public.orders
set payment_status = 'paid'
where status = 'paid' and payment_status = 'pending';

create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id, content)
values (
  1,
  jsonb_build_object(
    'homepage', jsonb_build_object(
      'banner_title', 'Purely Organic. Naturally Beautiful.',
      'banner_text', 'Thoughtful skincare for your everyday ritual.',
      'announcement', '',
      'featured_product_slugs', '[]'::jsonb
    ),
    'about', jsonb_build_object(
      'heading', 'Care, rooted in nature.',
      'text', 'BERRYO Organic Skincare creates thoughtful skincare for your daily routine.'
    ),
    'contact', jsonb_build_object(
      'business_name', 'BERRYO Organic Skincare',
      'email', 'Berryorganicskincare@gmail.com',
      'phone', '08034226547',
      'phone_alt', '07015996362',
      'address', 'Lugbe, Abuja, Nigeria'
    ),
    'social', jsonb_build_object(
      'instagram', '@berryo_skincare',
      'facebook', 'berryo_skincare',
      'wholesale_instagram', '@berryo_skincare_wholesale',
      'tiktok', ''
    ),
    'payment', jsonb_build_object(
      'method', 'moniepoint_transfer',
      'bank_name', 'Moniepoint',
      'account_name', 'BERRY0-ORGANICSKINCARE ENTERPRISE',
      'account_number', '8034226547'
    ),
    'shipping', jsonb_build_object(
      'fee_ngn', 1800,
      'information', 'Delivery details are confirmed after payment.'
    ),
    'categories', jsonb_build_array(
      'Face Care', 'Body Care', 'Soaps', 'Lip Care'
    )
  )
)
on conflict (id) do nothing;

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
  v_shipping_fee numeric(12, 2);
  v_payment_method text;
begin
  if v_customer_id is null then
    raise exception 'Sign in before placing an order.';
  end if;

  if coalesce(length(trim(p_customer_name)), 0) not between 1 and 160
    or coalesce(length(trim(p_customer_phone)), 0) not between 7 and 40
    or coalesce(length(trim(p_delivery_address)), 0) not between 5 and 1000 then
    raise exception 'Enter a valid name, phone number, and delivery address.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 50 then
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

  select
    case
      when settings.content #>> '{shipping,fee_ngn}' ~ '^\d+(\.\d{1,2})?$'
        then (settings.content #>> '{shipping,fee_ngn}')::numeric
      else 1800
    end,
    coalesce(nullif(settings.content #>> '{payment,method}', ''), 'moniepoint_transfer')
  into v_shipping_fee, v_payment_method
  from public.store_settings as settings
  where settings.id = 1;

  v_shipping_fee := coalesce(v_shipping_fee, 1800);
  if v_shipping_fee < 0 or v_shipping_fee > 100000 then
    raise exception 'The saved delivery fee is invalid. Contact the store administrator.';
  end if;

  v_order_code := 'BO-' || to_char(now(), 'YYYY') || '-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));

  insert into public.orders (
    order_code, customer_id, customer_name, customer_email, customer_phone,
    delivery_address, shipping_fee_ngn, subtotal_ngn, total_ngn, payment_method, status
  )
  select v_order_code, v_customer_id, trim(p_customer_name), users.email, trim(p_customer_phone),
    trim(p_delivery_address), v_shipping_fee, v_subtotal, v_subtotal + v_shipping_fee,
    v_payment_method, 'awaiting_payment'
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
    'order_id', v_order_id,
    'order_code', v_order_code,
    'total_ngn', v_subtotal + v_shipping_fee,
    'shipping_fee_ngn', v_shipping_fee,
    'payment_method', v_payment_method,
    'status', 'awaiting_payment'
  );
end;
$$;

revoke all on function public.create_customer_order(text, text, text, jsonb) from public;
grant execute on function public.create_customer_order(text, text, text, jsonb) to authenticated;

create or replace function public.submit_order_payment_proof(
  p_order_id uuid,
  p_payment_reference text,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_payment_reference text := trim(coalesce(p_payment_reference, ''));
begin
  if v_customer_id is null then
    raise exception 'Sign in to submit payment proof for your order.';
  end if;

  if length(v_payment_reference) not between 3 and 120 then
    raise exception 'Enter the Moniepoint transfer reference (3 to 120 characters).';
  end if;

  if p_proof_path is null
    or split_part(p_proof_path, '/', 1) <> p_order_id::text
    or split_part(p_proof_path, '/', 2) <> v_customer_id::text
    or split_part(p_proof_path, '/', 3) !~ '^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$'
    or array_length(string_to_array(p_proof_path, '/'), 1) <> 3 then
    raise exception 'The uploaded proof path is invalid.';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'customer-payment-proofs'
      and name = p_proof_path
  ) then
    raise exception 'Upload your transfer receipt before submitting it.';
  end if;

  update public.orders
  set payment_reference = v_payment_reference,
      payment_proof_path = p_proof_path,
      payment_status = 'submitted',
      payment_submitted_at = now()
  where id = p_order_id
    and customer_id = v_customer_id
    and payment_status in ('pending', 'failed')
    and status = 'awaiting_payment';

  if not found then
    raise exception 'This order is unavailable for a new payment submission.';
  end if;

  return jsonb_build_object('order_id', p_order_id, 'payment_status', 'submitted');
end;
$$;

revoke all on function public.submit_order_payment_proof(uuid, text, text) from public;
grant execute on function public.submit_order_payment_proof(uuid, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shipments enable row level security;
alter table public.store_settings enable row level security;

insert into public.profiles (id, full_name, phone)
select
  users.id,
  users.raw_user_meta_data ->> 'full_name',
  coalesce(users.phone, users.raw_user_meta_data ->> 'phone')
from auth.users as users
on conflict (id) do nothing;

create or replace function public.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

revoke all on function public.is_store_admin() from public;
grant execute on function public.is_store_admin() to anon, authenticated;

drop policy if exists "Customers can read their own profile" on public.profiles;
drop policy if exists "Admins can read profiles" on public.profiles;
create policy "Customers can read their own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);
create policy "Admins can read profiles"
on public.profiles for select to authenticated
using (public.is_store_admin());
grant select on public.profiles to authenticated;

drop policy if exists "Anyone can read active products" on public.products;
drop policy if exists "Admins manage products" on public.products;
create policy "Anyone can read active products"
on public.products for select to anon, authenticated
using (is_active = true or public.is_store_admin());
create policy "Admins manage products"
on public.products for all to authenticated
using (public.is_store_admin())
with check (public.is_store_admin());
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

drop policy if exists "Customers can read their own orders" on public.orders;
drop policy if exists "Admins manage orders" on public.orders;
create policy "Customers can read their own orders"
on public.orders for select to authenticated
using (auth.uid() = customer_id or public.is_store_admin());
create policy "Admins manage orders"
on public.orders for all to authenticated
using (public.is_store_admin())
with check (public.is_store_admin());
grant select, update on public.orders to authenticated;

drop policy if exists "Customers can read their own order items" on public.order_items;
drop policy if exists "Admins can read order items" on public.order_items;
create policy "Customers can read their own order items"
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.order_items.order_id
      and public.orders.customer_id = auth.uid()
  )
  or public.is_store_admin()
);
create policy "Admins can read order items"
on public.order_items for all to authenticated
using (public.is_store_admin())
with check (public.is_store_admin());
grant select, insert, update, delete on public.order_items to authenticated;

drop policy if exists "Customers can read their own shipments" on public.shipments;
drop policy if exists "Admins manage shipments" on public.shipments;
create policy "Customers can read their own shipments"
on public.shipments for select to authenticated
using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.shipments.order_id
      and public.orders.customer_id = auth.uid()
  )
  or public.is_store_admin()
);
create policy "Admins manage shipments"
on public.shipments for all to authenticated
using (public.is_store_admin())
with check (public.is_store_admin());
grant select, insert, update, delete on public.shipments to authenticated;

drop policy if exists "Anyone can read store settings" on public.store_settings;
drop policy if exists "Admins manage store settings" on public.store_settings;
create policy "Anyone can read store settings"
on public.store_settings for select to anon, authenticated
using (true);
create policy "Admins manage store settings"
on public.store_settings for all to authenticated
using (public.is_store_admin())
with check (public.is_store_admin());
grant select on public.store_settings to anon, authenticated;
grant insert, update, delete on public.store_settings to authenticated;

create or replace function public.admin_list_customers()
returns table (
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  order_count bigint,
  total_spent numeric,
  last_order_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_store_admin() then
    raise exception 'Store admin access is required.';
  end if;

  return query
  with account_customers as (
    select
      profiles.id as customer_id,
      coalesce(
        nullif(trim(profiles.full_name), ''),
        nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
        users.email::text,
        'Customer'
      )::text as customer_name,
      users.email::text as customer_email,
      coalesce(profiles.phone, users.phone, max(orders.customer_phone))::text as customer_phone,
      count(orders.id)::bigint as order_count,
      coalesce(sum(orders.total_ngn) filter (where orders.payment_status = 'paid'), 0)::numeric as total_spent,
      max(orders.created_at) as last_order_at
    from public.profiles as profiles
    join auth.users as users on users.id = profiles.id
    left join public.orders as orders on orders.customer_id = profiles.id
    group by profiles.id, profiles.full_name, profiles.phone, users.email, users.phone, users.raw_user_meta_data
  ),
  guest_customers as (
    select
      null::uuid as customer_id,
      max(orders.customer_name)::text as customer_name,
      max(orders.customer_email)::text as customer_email,
      max(orders.customer_phone)::text as customer_phone,
      count(*)::bigint as order_count,
      coalesce(sum(orders.total_ngn) filter (where orders.payment_status = 'paid'), 0)::numeric as total_spent,
      max(orders.created_at) as last_order_at
    from public.orders as orders
    where orders.customer_id is null
      and (
        nullif(trim(orders.customer_email), '') is not null
        or nullif(trim(orders.customer_phone), '') is not null
      )
    group by
      lower(coalesce(nullif(trim(orders.customer_email), ''), '')),
      regexp_replace(coalesce(orders.customer_phone, ''), '[^0-9]', '', 'g')
  )
  select
    customers.*
  from (
    select * from account_customers
    union all
    select * from guest_customers
  ) as customers
  order by customers.last_order_at desc nulls last, customers.customer_name;
end;
$$;

revoke all on function public.admin_list_customers() from public;
grant execute on function public.admin_list_customers() to authenticated;

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_store_admin() then
    raise exception 'Store admin access is required.';
  end if;

  return query
  select users.id, users.email::text, profiles.full_name, profiles.is_admin, users.created_at
  from auth.users as users
  join public.profiles as profiles on profiles.id = users.id
  order by users.created_at;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_set_user_role(p_email text, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_target_id uuid;
begin
  if not public.is_store_admin() then
    raise exception 'Store admin access is required.';
  end if;

  select id into v_target_id
  from auth.users
  where lower(email) = lower(trim(p_email))
    and email_confirmed_at is not null;

  if v_target_id is null then
    raise exception 'No verified user account exists for that email.';
  end if;

  if v_target_id = auth.uid() and not p_is_admin then
    raise exception 'You cannot remove your own admin role.';
  end if;

  if not p_is_admin and (
    select count(*) from public.profiles where is_admin = true
  ) <= 1 then
    raise exception 'At least one store admin must remain.';
  end if;

  insert into public.profiles (id, full_name, is_admin)
  select id, raw_user_meta_data ->> 'full_name', p_is_admin
  from auth.users
  where id = v_target_id
  on conflict (id) do update
    set is_admin = excluded.is_admin;
end;
$$;

revoke all on function public.admin_set_user_role(text, boolean) from public;
grant execute on function public.admin_set_user_role(text, boolean) to authenticated;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-payment-proofs',
  'customer-payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read product images" on storage.objects;
drop policy if exists "Admins manage product images" on storage.objects;
drop policy if exists "Customers upload own payment proofs" on storage.objects;
drop policy if exists "Admins read payment proofs" on storage.objects;
create policy "Public can read product images"
on storage.objects for select to anon, authenticated
using (bucket_id = 'product-images');
create policy "Admins manage product images"
on storage.objects for all to authenticated
using (bucket_id = 'product-images' and public.is_store_admin())
with check (bucket_id = 'product-images' and public.is_store_admin());
create policy "Customers upload own payment proofs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'customer-payment-proofs'
  and split_part(name, '/', 2) = auth.uid()::text
  and exists (
    select 1 from public.orders
    where public.orders.id::text = split_part(storage.objects.name, '/', 1)
      and public.orders.customer_id = auth.uid()
      and public.orders.payment_status in ('pending', 'failed')
      and public.orders.status = 'awaiting_payment'
  )
);
create policy "Admins read payment proofs"
on storage.objects for select to authenticated
using (bucket_id = 'customer-payment-proofs' and public.is_store_admin());

create or replace function public.create_customer_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.create_customer_profile();

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id
  from auth.users
  where lower(email) = lower('berryorganicskincare@gmail.com')
    and email_confirmed_at is not null;

  if v_admin_id is null then
    raise notice 'Admin console schema is installed. Verify berryorganicskincare@gmail.com, then promote the account before signing in.';
  else
    insert into public.profiles (id, full_name, is_admin)
    select id, raw_user_meta_data ->> 'full_name', true
    from auth.users
    where id = v_admin_id
    on conflict (id) do update set is_admin = true;
  end if;
end;
$$;

notify pgrst, 'reload schema';
