# DON / Anniversary Import, 2026-08-31

## Why Prices Were Missing

- OPTCG DON catalog identifiers are lowercase (`don_101`). The exact catalog
  lookup uppercased them, while PostgreSQL's `in` comparison is case-sensitive.
- None of the 187 DON rows had an exact Cardmarket product mapping. `DON!! Card`
  names also differ from Cardmarket's `DON!!` names.
- Removing `Card` from the name is not sufficient: standard, silver and Gold
  printings often share the same artwork and rules. A generic name/price-based
  fallback can assign another finish or even another language.

`don-cardmarket-2026-08-31.json` records 161 reviewed image pairs. Product images,
language and visible finish/stamps were checked before applying the mappings.
The production lookup uses the stored product ID, never a runtime nearest-image
price guess. Manually chosen IDs and fixed prices take precedence.

English PRB01 uses expansion 5805; English PRB02 uses 6242. In these reviewed
families V1 is standard and V3 Gold. This is evidence about those products, not
a general rule to extrapolate to future releases. In particular OP17 Rocks
Pirates V2 (904167) was inserted before V1 (904350).

Some OPPR product images are Japanese despite sharing the general promo
expansion. They were excluded. Unverified DON printings remain without a price,
not zero and not a price borrowed from a similarly named card.

## New Cards

Seven English 4th Anniversary Treasure Campaign cards were verified via the
Cardmarket image archive: 902487, 902489, 902491, 902492, 902493, 902494, 902495.
Their printed rules come from existing same-code cards; their images and price
IDs are variant-specific. `is_manual` protects these imports during catalog
sync. Existing DON mappings also survive sync: `canonicalRow` does not write
`cardmarket_product_id` or `cardmarket_url`.

The requested silhouette DON is the second design on Bandai's DP12 page:
https://en.onepiece-cardgame.com/products/dp12.html

It is **not** the OP17 Rocks Pirates booster illustration. Its exact Cardmarket
product was not found in the export or the searched product pages on this date.
It is stored as `don_dp12_02`, using the owner's full-card English SAMPLE image
verified against Bandai's `img_item04.webp`. Do not attach a Shanks/PRB or Rocks
Pirates/OP17 price based on the character alone. Once that entry becomes
available, verify its artwork and attach its exact product ID to the catalog
row; prices then follow daily updates.

## Re-running and Testing

`scripts/import-verified-promo-don.ts` defaults to dry-run. `--confirm` applies
only missing mappings/imports, preserves existing Admin choices and creates a
local ignored backup before writing. The DP12 import also needs the reviewed
attachment via `--don-image=...`; its SHA256 is checked. Re-running skips imported
products/images. Never rerun it concurrently with another catalog import.

Run `npm run test:don-prices`, `npm run test:price-matcher`, and (with server-side
Supabase credentials) `npm run test:don-recognition`. Regenerate
`lib/donImageSignatures.generated.ts` after adding DON artwork. No Google Vision
calls or image matching against Cardmarket are needed during price lookup.
