-- Run once in Supabase → SQL Editor.

-- 1. Server sets updated_at on every write (the sync cursor depends on it)
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = clock_timestamp();   -- unique per row, safe as a sync cursor
  return new;
end $$;

-- 2. Payment methods: cards, accounts, UPI apps, cash
create table payment_methods (
  id          uuid primary key,                       -- made on the device
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,                          -- "SBI Credit Card"
  type        text not null check (type in ('credit_card','debit_card','bank_account','upi','wallet','cash')),
  bank        text,                                   -- "SBI"  (matches parser.bank)
  last4       text check (last4 ~ '^\d{4}$'),         -- "1046" (matches parser.last4)
  keywords    text[] not null default '{}',           -- extra hints, e.g. {'sbicard'}
  is_default  boolean not null default false,         -- preselected for manual entries
  archived    boolean not null default false,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- 3. Categories (one level of sub-categories)
create table categories (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  kind        text not null default 'expense' check (kind in ('expense','income','transfer')),
  icon        text,
  color       text,
  parent_id   uuid references categories(id),
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- 4. Transactions
create table transactions (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  amount             numeric(12,2) not null check (amount >= 0),
  direction          text not null default 'debit' check (direction in ('debit','credit')),
  occurred_on        date not null,
  merchant           text,                            -- as shown: "AMAZON PAY IN"
  merchant_key       text,                            -- normalised: "amazon pay"
  payment_method_id  uuid references payment_methods(id),
  category_id        uuid references categories(id),
  notes              text,
  tags               text[] not null default '{}',
  source             text not null default 'manual' check (source in ('sms','manual','import')),
  raw_sms            text,                            -- original message, re-parse later
  ref_no             text,                            -- UPI / txn reference
  fingerprint        text,                            -- duplicate guard
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (user_id, fingerprint)
);

-- 5. Learned rules: merchant -> category (+ optional payment method)
create table merchant_rules (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  merchant_key       text not null,
  category_id        uuid references categories(id),
  payment_method_id  uuid references payment_methods(id),
  hits               int not null default 1,
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (user_id, merchant_key)
);

-- 6. Indexes for sync pulls and monthly views
create index on payment_methods (user_id, updated_at);
create index on categories      (user_id, updated_at);
create index on merchant_rules  (user_id, updated_at);
create index on transactions    (user_id, updated_at);
create index on transactions    (user_id, occurred_on desc);

-- 7. Triggers + Row Level Security
create trigger trg_pm_updated  before insert or update on payment_methods for each row execute function set_updated_at();
create trigger trg_cat_updated before insert or update on categories      for each row execute function set_updated_at();
create trigger trg_tx_updated  before insert or update on transactions    for each row execute function set_updated_at();
create trigger trg_mr_updated  before insert or update on merchant_rules  for each row execute function set_updated_at();

alter table payment_methods enable row level security;
alter table categories      enable row level security;
alter table transactions    enable row level security;
alter table merchant_rules  enable row level security;

create policy own_rows on payment_methods for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on categories      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on transactions    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on merchant_rules  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 8. Report view: monthly spend per category
create view monthly_category_spend with (security_invoker = on) as
select date_trunc('month', t.occurred_on)::date as month,
       c.name as category,
       sum(t.amount) filter (where t.direction = 'debit')  as spent,
       sum(t.amount) filter (where t.direction = 'credit') as received
from transactions t
left join categories c on c.id = t.category_id
where t.deleted_at is null
group by 1, 2;
