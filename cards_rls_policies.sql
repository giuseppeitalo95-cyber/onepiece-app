-- POLICIES SEMPLICI PER LA TABELLA CARDS
-- Le carte aggiunte manualmente devono essere visibili a tutti per le ricerche

-- Abilita RLS sulla tabella cards
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

-- Rimuovi eventuali policies esistenti
DROP POLICY IF EXISTS "Public can view cards" ON cards;
DROP POLICY IF EXISTS "Allow all operations on cards" ON cards;

-- Policy unica: permetti tutte le operazioni (lettura, scrittura, modifica)
-- Poiché gestisci tutto manualmente da Supabase, non servono restrizioni
CREATE POLICY "Allow all operations on cards" ON cards
    FOR ALL USING (true);