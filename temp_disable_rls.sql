-- EMERGENZA: DISABILITA TEMPORANEAMENTE RLS PER TEST
-- Esegui questo SOLO per testare se RLS sta bloccando la lettura

-- Disabilita RLS sulla tabella cards (temporaneamente)
ALTER TABLE cards DISABLE ROW LEVEL SECURITY;

-- Ora testa la ricerca - se vedi le carte, il problema era RLS

-- Dopo il test, RIABILITA RLS con:
-- ALTER TABLE cards ENABLE ROW LEVEL SECURITY;