# Google Vision scan setup

## Environment variables

Set these variables locally and in Vercel:

```env
GOOGLE_VISION_API_KEY=your_google_vision_api_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
NEXT_PUBLIC_SUPABASE_URL=https://jxwgbzatdueefdiyxlns.supabase.co
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.

## Supabase setup

Run the SQL in `google_vision_scan_limit.sql` in the Supabase SQL editor.

It creates:

- `scan_usage_global`
- `increment_global_scan_usage(...)`

The API reserves one scan before calling Google Vision. When the monthly global counter reaches 1000, scans are blocked before any Google request is made.

## Google Cloud setup

1. Create or open a Google Cloud project.
2. Enable Cloud Vision API.
3. Create an API key.
4. Add the API key to Vercel as `GOOGLE_VISION_API_KEY`.
5. Restrict the key in Google Cloud if possible.
