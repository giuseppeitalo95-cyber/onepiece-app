# Migrazione catalogo OPV

## Prima attivazione

1. Eseguire `card_catalog.sql` nel SQL Editor del progetto Supabase.
2. Pubblicare il codice su Vercel.
3. Aprire `Admin > Servizi` e premere `Aggiorna catalogo`.
4. Verificare che compaiano circa 8.700 righe sorgente e 4.700 carte catalogo.
5. Premere `Migra tutte` e lasciare aperta la pagina fino a quando `Da copiare` arriva a zero.
6. Aprire `Admin > Status` e verificare Supabase, Cloudflare R2 e API catalogo.

## Funzionamento normale

- Ricerca, scanner, deck e prezzi leggono Supabase.
- Le immagini del catalogo usano direttamente gli URL Cloudflare R2.
- Il cron manutenzione aggiorna il catalogo una volta al giorno e copia le immagini nuove.
- Il proxy immagini conserva un fallback controllato durante la migrazione o in caso di vecchi URL salvati.
- R2 blocca i nuovi upload a 9 GB, prima dei 10 GB inclusi nel piano gratuito.

## Ripristino

La migrazione non elimina le fonti originali e non modifica le tabelle delle collezioni. Se il catalogo Supabase e vuoto o non disponibile, OPV usa temporaneamente le fonti precedenti; questo permette di completare o correggere la migrazione senza interrompere ricerca e scanner.
