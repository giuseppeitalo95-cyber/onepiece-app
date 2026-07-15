<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## One Piece Vault workflow

- Read the surrounding implementation before changing behavior. The app has shared card, price, auth, scanner and premium flows.
- Keep secrets in Vercel/Supabase environment variables. Never commit API keys, service-role keys, Stripe secrets or webhook secrets.
- Run `npm run build` before publishing.
- Publish one intentional commit per completed request. A push to `main` already triggers Vercel, so do not also run a manual production deploy.
- Preserve existing Supabase migrations and document any SQL the owner must run.
- Keep mobile and desktop layouts working; the app is primarily used as an installed mobile PWA.
