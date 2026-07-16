import { syncCardCatalog, syncCatalogImages } from '../lib/cardCatalogSync'

const args = new Set(process.argv.slice(2))
const catalogOnly = args.has('--catalog-only')
const imagesOnly = args.has('--images-only')
const batchArg = process.argv.find(arg => arg.startsWith('--batch='))
const batchSize = Math.max(1, Math.min(100, Number(batchArg?.split('=')[1] || 80)))

const run = async () => {
  if (!imagesOnly) {
    const catalog = await syncCardCatalog()
    console.log(`Catalogo: ${catalog.catalogRows} carte canoniche, ${catalog.sourceRows} righe sorgente.`)
  }

  if (catalogOnly) return

  let round = 0
  let totalReady = 0
  let totalFailed = 0
  while (round < 250) {
    round += 1
    const result = await syncCatalogImages(batchSize)
    totalReady += result.ready
    totalFailed += result.failed
    console.log(`Immagini lotto ${round}: ${result.ready} pronte, ${result.failed} fallite, ${result.remaining} restanti.`)
    if (result.blocked > 0) throw new Error('Migrazione fermata dal limite di sicurezza R2.')
    if (result.processed === 0 || result.remaining === 0) break
  }

  console.log(`Migrazione immagini conclusa: ${totalReady} copiate, ${totalFailed} fallite.`)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
