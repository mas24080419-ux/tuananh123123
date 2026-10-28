CREATE TABLE IF NOT EXISTS dining_tables (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE, token text UNIQUE NOT NULL,
 zone text NOT NULL DEFAULT 'Tầng 1', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS menu_items (
 id uuid PRIMARY KEY, name text NOT NULL, category text NOT NULL,
 price integer NOT NULL CHECK(price >= 0), station text NOT NULL CHECK (station IN ('kitchen','bar')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dining_orders (
 id uuid PRIMARY KEY, table_id uuid NOT NULL REFERENCES dining_tables(id),
 request_id uuid NOT NULL, note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(table_id,request_id)
);
CREATE TABLE IF NOT EXISTS dining_order_lines (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES dining_orders(id),
 menu_item_id uuid NOT NULL REFERENCES menu_items(id), name text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20), unit_price integer NOT NULL CHECK(unit_price >= 0),
 station text NOT NULL CHECK(station IN ('kitchen','bar')),
 note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','ready','served','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dining_order_lines_order ON dining_order_lines(order_id);
CREATE INDEX IF NOT EXISTS ix_dining_order_lines_station_status ON dining_order_lines(station,status);
CREATE INDEX IF NOT EXISTS ix_dining_orders_date ON dining_orders(created_at DESC);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
 CHECK(payment_status IN ('unpaid','paid','refunded'));
CREATE TABLE IF NOT EXISTS dining_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id uuid REFERENCES dining_orders(id),
 item_id uuid REFERENCES dining_order_lines(id),
 actor text NOT NULL CHECK(actor IN ('guest','staff','system')),
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dining_audit_order ON dining_audit(order_id,created_at);

-- Payment choice is separate from payment confirmation; existing orders remain unknown (NULL).
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS payment_method text
 CHECK (payment_method IN ('cash','bank_transfer'));

-- Administrative payment confirmation. Historical rows remain unchanged.
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS paid_amount bigint
 CHECK (paid_amount >= 0);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE INDEX IF NOT EXISTS ix_dining_orders_paid_at ON dining_orders(paid_at DESC)
 WHERE payment_status = 'paid';


-- SalesHub finance and stock v1. No historical balances, stock or income is fabricated.
CREATE TABLE IF NOT EXISTS inventory_items (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE,
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 16),
 quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK(quantity>=0),
 reorder_level numeric(14,3) NOT NULL DEFAULT 0 CHECK(reorder_level>=0),
 avg_unit_cost bigint NOT NULL DEFAULT 0 CHECK(avg_unit_cost>=0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_recipes (
 menu_item_id uuid NOT NULL REFERENCES menu_items(id),
 inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
 quantity_per_unit numeric(14,3) NOT NULL CHECK(quantity_per_unit>0),
 PRIMARY KEY(menu_item_id,inventory_item_id)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id uuid PRIMARY KEY,
 inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
 delta numeric(14,3) NOT NULL CHECK(delta<>0),
 kind text NOT NULL CHECK(kind IN ('purchase','opening','adjustment_in','adjustment_out','consume','restore')),
 unit_cost bigint NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
 note text NOT NULL DEFAULT '',
 order_line_id uuid REFERENCES dining_order_lines(id),
 request_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_orderline ON inventory_movements(order_line_id);
CREATE TABLE IF NOT EXISTS finance_entries (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 direction text NOT NULL CHECK(direction IN ('income','expense')),
 category text NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 60),
 amount bigint NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','bank_transfer')),
 note text NOT NULL DEFAULT '',
 source text NOT NULL CHECK(source IN ('manual','stock_purchase')),
 inventory_movement_id uuid UNIQUE REFERENCES inventory_movements(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_entries_date ON finance_entries(created_at DESC);


-- SalesHub V10 / Backend-first — non-destructive, backwards-compatible.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sku text UNIQUE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS capacity int NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 30);
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS service_status text NOT NULL DEFAULT 'available'
 CHECK (service_status IN ('available','occupied','reserved','cleaning'));
CREATE TABLE IF NOT EXISTS suppliers (
 id uuid PRIMARY KEY,
 name text NOT NULL UNIQUE,
 phone text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 address text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 phone text UNIQUE,
 email text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS table_reservations (
 id uuid PRIMARY KEY,
 table_id uuid NOT NULL REFERENCES dining_tables(id),
 customer_id uuid REFERENCES customers(id),
 customer_name text NOT NULL,
 customer_phone text NOT NULL DEFAULT '',
 guests int NOT NULL CHECK(guests BETWEEN 1 AND 30),
 reserved_at timestamptz NOT NULL,
 duration_minutes int NOT NULL DEFAULT 120 CHECK(duration_minutes BETWEEN 30 AND 480),
 status text NOT NULL DEFAULT 'confirmed'
 CHECK (status IN ('confirmed','arrived','cancelled','completed','no_show')),
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservations_table_time ON table_reservations(table_id,reserved_at);
CREATE INDEX IF NOT EXISTS idx_reservations_time ON table_reservations(reserved_at DESC);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS invoice_reference text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS register_shifts (
 id uuid PRIMARY KEY,
 opened_by text NOT NULL DEFAULT 'admin',
 opened_at timestamptz NOT NULL DEFAULT now(),
 opening_cash bigint NOT NULL CHECK(opening_cash>=0),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 closed_at timestamptz,
 closed_by text,
 counted_cash bigint CHECK(counted_cash>=0),
 expected_cash bigint,
 variance bigint,
 note text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_only_one_open_register ON register_shifts((true)) WHERE status='open';

CREATE TABLE IF NOT EXISTS pos_audit (
 id uuid PRIMARY KEY,
 actor text NOT NULL,
 entity text NOT NULL,
 entity_id uuid,
 action text NOT NULL,
 before_state jsonb,
 after_state jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_audit_date ON pos_audit(created_at DESC);


-- Named employee identities. Individual login sessions can be revoked by incrementing auth_version.
CREATE TABLE IF NOT EXISTS staff_users (
 id uuid PRIMARY KEY,
 username text NOT NULL UNIQUE,
 display_name text NOT NULL,
 role text NOT NULL CHECK(role IN ('manager','cashier','waiter','kitchen','bar')),
 password_salt text NOT NULL,
 password_hash text NOT NULL,
 auth_version int NOT NULL DEFAULT 1 CHECK(auth_version>0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_users_active ON staff_users(active);


-- Tắm Tráng 6 payment recipient, admin-configured only. Never prefill a fictitious bank account.
CREATE TABLE IF NOT EXISTS merchant_payment_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton=true),
 bank_bin varchar(6) NOT NULL CHECK(bank_bin ~ '^[0-9]{6}$'),
 account_number varchar(25) NOT NULL CHECK(account_number ~ '^[0-9]{6,25}$'),
 account_name varchar(100) NOT NULL CHECK(length(trim(account_name)) BETWEEN 2 AND 100),
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);


-- Owner credentials on Neon. Passwords are scrypt-hashed with independent random salt.
-- A changed password increments auth_version and invalidates every existing owner cookie.
CREATE TABLE IF NOT EXISTS owner_accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email=lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  password_salt text NOT NULL CHECK (password_salt ~ '^[0-9a-f]{32}$'),
  password_hash text NOT NULL CHECK (password_hash ~ '^[0-9a-f]{128}$'),
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz
);

-- Area-scoped employees and immutable service receipts.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS work_area text CHECK(work_area IN ('equipment','restroom'));
CREATE TABLE IF NOT EXISTS area_receipts (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 area text NOT NULL CHECK(area IN ('equipment','restroom')),
 service text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
 staff_user_id uuid REFERENCES staff_users(id),
 finance_entry_id uuid NOT NULL UNIQUE REFERENCES finance_entries(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((area='equipment' AND service IN ('float','locker')) OR (area='restroom' AND service='restroom'))
);
CREATE INDEX IF NOT EXISTS idx_area_receipts_area_date ON area_receipts(area,created_at DESC);

-- Locker map A1-A30 / B1-B30 and rental history.
CREATE TABLE IF NOT EXISTS lockers (
 code text PRIMARY KEY CHECK(code ~ '^[AB]([1-9]|[12][0-9]|30)$'),
 zone text NOT NULL CHECK(zone IN ('A','B')),
 position integer NOT NULL CHECK(position BETWEEN 1 AND 30),
 UNIQUE(zone,position),CHECK(code=zone||position::text)
);
INSERT INTO lockers(code,zone,position) SELECT zone||n::text,zone,n FROM unnest(ARRAY['A','B']) AS zone CROSS JOIN generate_series(1,30) AS n ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS locker_rentals (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 locker_code text NOT NULL REFERENCES lockers(code),
 customer_name text NOT NULL CHECK(length(trim(customer_name)) BETWEEN 2 AND 90),
 customer_phone text NOT NULL CHECK(customer_phone ~ '^\+?[0-9]{8,15}$'),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=250),
 opened_by uuid,
 closed_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 CHECK(ended_at IS NULL OR ended_at>=created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locker_one_active ON locker_rentals(locker_code) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_locker_rentals_date ON locker_rentals(created_at DESC);

-- Fixed locker fee; existing historical rentals are not backfilled.
ALTER TABLE locker_rentals ADD COLUMN IF NOT EXISTS charged_amount bigint CHECK(charged_amount=30000);
ALTER TABLE locker_rentals ADD COLUMN IF NOT EXISTS payment_method text CHECK(payment_method IN ('cash','bank_transfer'));
ALTER TABLE locker_rentals ADD COLUMN IF NOT EXISTS finance_entry_id uuid UNIQUE REFERENCES finance_entries(id);

-- Server-priced float service variants.
CREATE TABLE IF NOT EXISTS float_receipt_details (
 receipt_id uuid PRIMARY KEY REFERENCES area_receipts(id),
 float_type text NOT NULL CHECK(float_type IN ('child_vest','black_adult','child_float')),
 unit_price integer NOT NULL,
 CHECK((float_type IN ('child_vest','child_float') AND unit_price=20000) OR (float_type='black_adult' AND unit_price=30000))
);

-- MB Bank and VietinBank trial: no real bank identifiers are pre-filled.
CREATE TABLE IF NOT EXISTS merchant_bank_accounts(
 bank_bin varchar(6) PRIMARY KEY CHECK(bank_bin IN ('970422','970415')),
 account_number varchar(25) NOT NULL CHECK(account_number ~ '^[0-9]{6,25}$'),
 account_name varchar(100) NOT NULL CHECK(length(trim(account_name)) BETWEEN 2 AND 100),
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO merchant_bank_accounts(bank_bin,account_number,account_name,enabled)
 SELECT bank_bin,account_number,account_name,enabled FROM merchant_payment_settings
 WHERE singleton=true AND bank_bin IN ('970422','970415')
 ON CONFLICT(bank_bin) DO NOTHING;
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS transfer_bank_bin varchar(6);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS transfer_account_number varchar(25);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS transfer_account_name varchar(100);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS payment_reference varchar(23);
CREATE UNIQUE INDEX IF NOT EXISTS ix_dining_payment_reference ON dining_orders(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE TABLE IF NOT EXISTS bank_webhook_transactions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source text NOT NULL DEFAULT 'sepay' CHECK(source='sepay'),
 external_id varchar(40) NOT NULL,
 bank_bin varchar(6),
 account_number varchar(25),
 amount bigint NOT NULL CHECK(amount>0),
 payment_reference varchar(23),
 order_id uuid REFERENCES dining_orders(id),
 status text NOT NULL CHECK(status IN ('needs_review','verified_test','auto_paid','already_paid')),
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,external_id)
);
CREATE INDEX IF NOT EXISTS ix_bank_webhook_order ON bank_webhook_transactions(order_id) WHERE order_id IS NOT NULL;
