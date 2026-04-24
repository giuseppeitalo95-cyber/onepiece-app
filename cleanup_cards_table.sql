-- Rimuovi colonne non necessarie dalla tabella cards
-- Questa tabella dovrebbe contenere solo carte "globali" aggiunte manualmente

-- Rimuovi colonna quantity (non serve per carte globali)
ALTER TABLE cards DROP COLUMN IF EXISTS quantity;

-- Rimuovi colonna user_id (non serve sapere chi ha aggiunto ogni carta)
ALTER TABLE cards DROP COLUMN IF EXISTS user_id;

-- Mantieni id (chiave primaria) e created_at (audit trail)
-- Queste colonne sono utili per manutenzione e debugging