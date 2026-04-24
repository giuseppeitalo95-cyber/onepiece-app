-- SCRIPT DI DEBUG PER LA TABELLA CARDS
-- Esegui questo per verificare se i dati ci sono e se RLS sta bloccando

-- 1. Verifica se ci sono dati nella tabella cards
SELECT COUNT(*) as total_cards FROM cards;

-- 2. Mostra alcune carte di esempio
SELECT card_id, name, rarity FROM cards LIMIT 5;

-- 3. Verifica se RLS è abilitato
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'cards' AND schemaname = 'public';

-- 4. Mostra le policies esistenti
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'cards';

-- 5. Test query diretta (dovrebbe funzionare anche con RLS)
SELECT card_id, name FROM cards WHERE name ILIKE '%test%' LIMIT 5;