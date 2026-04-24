-- POLICIES PER LA TABELLA CARDS
-- Questa tabella contiene carte aggiunte manualmente e deve essere leggibile da tutti

-- Prima abilita RLS sulla tabella cards (se non già abilitato)
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

-- Rimuovi eventuali policies esistenti
DROP POLICY IF EXISTS "Public can view cards" ON cards;
DROP POLICY IF EXISTS "Admin can insert cards" ON cards;
DROP POLICY IF EXISTS "Admin can update cards" ON cards;
DROP POLICY IF EXISTS "Admin can delete cards" ON cards;

-- Policy per permettere a tutti di leggere le carte (necessario per le ricerche)
CREATE POLICY "Public can view cards" ON cards
    FOR SELECT USING (true);

-- Policy per permettere all'admin di inserire carte
CREATE POLICY "Admin can insert cards" ON cards
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Policy per permettere all'admin di aggiornare carte
CREATE POLICY "Admin can update cards" ON cards
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Policy per permettere all'admin di eliminare carte
CREATE POLICY "Admin can delete cards" ON cards
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );