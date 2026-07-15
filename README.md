# One Piece Vault

Web app/PWA per scannerizzare carte One Piece, gestire collezione e deck, consultare prezzi, amici, annunci e chat temporanee.

## Stack

- Next.js 16 e React 19
- Supabase per autenticazione, database e dati utente
- Vercel per build, deploy, API server e cron
- Google Cloud Vision per OCR dello scanner
- Stripe per Premium
- Sincronizzazione periodica dei prezzi nel database

## Sviluppo locale

```bash
npm install
npm run dev
```

Prima di pubblicare:

```bash
npm run build
```

## Modifiche da telefono

Il repository `giuseppeitalo95-cyber/onepiece-app` e il progetto Vercel `onepiece-app` sono gia collegati. Questo permette di lavorare con il PC spento usando un agente cloud:

1. Apri Codex o ChatGPT dal telefono e collega una sola volta il tuo account GitHub.
2. Seleziona il repository `giuseppeitalo95-cyber/onepiece-app` e il branch `main`.
3. Chiedi la modifica e fai eseguire `npm run build`.
4. Invia un solo commit su `main`: Vercel avvia automaticamente un solo deploy.
5. Controlla che il deployment risulti `Ready` prima di provare il sito.

Le chiavi private restano nelle Environment Variables di Vercel e non devono mai essere scritte nel repository o in chat.
