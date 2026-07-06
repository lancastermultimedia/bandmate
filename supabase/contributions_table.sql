-- ══════════════════════════════════════════════════════════════════
-- Bandmate — contributions table
-- Tracks supporter payments for the gauge/van funding display.
-- Run these statements ONE AT A TIME in Supabase SQL Editor.
-- ══════════════════════════════════════════════════════════════════

-- 1. Create table
CREATE TABLE IF NOT EXISTS contributions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amount         numeric        NOT NULL CHECK (amount > 0),
  category       text           NOT NULL DEFAULT 'general'
                   CHECK (category IN ('maps', 'database', 'hosting', 'general')),
  is_recurring   boolean        NOT NULL DEFAULT false,
  supporter_name text,                        -- optional public display name
  created_at     timestamptz    NOT NULL DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────
-- RLS Policies
-- Run each separately — PostgreSQL has no CREATE POLICY IF NOT EXISTS
-- ──────────────────────────────────────────────────────────────────

-- Anyone (anon + authenticated) can read totals for the gauges
CREATE POLICY "Anyone can read contributions"
  ON contributions FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only authenticated users can insert (prevents fake gauge inflation)
-- Admin manually inserts after Ko-fi payouts; Stripe webhook uses service_role
CREATE POLICY "Authenticated users can insert contributions"
  ON contributions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- No UPDATE or DELETE — contributions are an immutable audit record
-- (If you need to reverse a contribution, insert a negative-amount row)

-- ──────────────────────────────────────────────────────────────────
-- Optional: index for fast current-month queries
-- ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS contributions_created_at_idx
  ON contributions (created_at DESC);

CREATE INDEX IF NOT EXISTS contributions_category_idx
  ON contributions (category);

-- ──────────────────────────────────────────────────────────────────
-- Test insert (run manually to verify, then delete)
-- ──────────────────────────────────────────────────────────────────
-- INSERT INTO contributions (amount, category, is_recurring, supporter_name)
-- VALUES (10.00, 'maps', true, 'Test Band');
