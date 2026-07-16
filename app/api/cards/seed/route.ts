export async function GET() {
  return Response.json({
    ok: false,
    error: 'Endpoint dismesso. Usa la sincronizzazione Catalogo OPV dalla pagina Admin.',
  }, { status: 410 })
}

export async function POST() {
  return GET()
}
