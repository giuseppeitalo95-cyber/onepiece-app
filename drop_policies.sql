-- COMANDI PER ELIMINARE LE POLICIES ESISTENTI (se necessario):

-- Elimina tutte le policies esistenti su profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON profiles;

-- Elimina tutte le policies esistenti su missing_card_reports
DROP POLICY IF EXISTS "Users can view own reports" ON missing_card_reports;
DROP POLICY IF EXISTS "Users can insert reports" ON missing_card_reports;
DROP POLICY IF EXISTS "Admin can view all reports" ON missing_card_reports;
DROP POLICY IF EXISTS "Admin can update all reports" ON missing_card_reports;
DROP POLICY IF EXISTS "Admin can delete reports" ON missing_card_reports;

-- Poi riesegui il file policies.sql