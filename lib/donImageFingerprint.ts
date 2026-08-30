import sharp from 'sharp'

export const DON_FINGERPRINT_WIDTH = 24
export const DON_FINGERPRINT_HEIGHT = 34

const prepare = (input: Buffer) => sharp(input)
  .rotate()
  .flatten({ background: '#ffffff' })
  .resize(DON_FINGERPRINT_WIDTH, DON_FINGERPRINT_HEIGHT, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3,
  })
  .removeAlpha()
  .raw()
  .toBuffer()

export const createDonImageFingerprint = async (input: Buffer) => prepare(input)

// Upstream sources sometimes return a landscape "Image Coming Soon" banner.
// Reject non-card assets so a placeholder can never become a DON match.
export const isPlausibleDonImage = async (input: Buffer) => {
  const metadata = await sharp(input).metadata()
  const width = metadata.width || 0
  const height = metadata.height || 0
  const ratio = height > 0 ? width / height : 0
  return width >= 180 && height >= 250 && ratio >= 0.5 && ratio <= 0.82
}

export const encodeDonImageFingerprint = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64')

export const decodeDonImageFingerprint = (value: string) => Buffer.from(value, 'base64')

const channelStats = (value: Uint8Array) => {
  const means = [0, 0, 0]
  const pixels = value.length / 3
  for (let index = 0; index < value.length; index += 3) {
    means[0] += value[index]
    means[1] += value[index + 1]
    means[2] += value[index + 2]
  }
  return means.map(total => total / pixels)
}

// DON cards share the same rules text, so the illustration carries most of the
// identity. Lighting-normalized structure is weighted heavily while some raw
// color remains to distinguish gold, silver and colored special printings.
export const donFingerprintDistance = (query: Uint8Array, candidate: Uint8Array) => {
  if (query.length !== candidate.length || query.length !== DON_FINGERPRINT_WIDTH * DON_FINGERPRINT_HEIGHT * 3) {
    return Number.POSITIVE_INFINITY
  }

  const queryMeans = channelStats(query)
  const candidateMeans = channelStats(candidate)
  let difference = 0
  let totalWeight = 0

  for (let y = 0; y < DON_FINGERPRINT_HEIGHT; y += 1) {
    for (let x = 0; x < DON_FINGERPRINT_WIDTH; x += 1) {
      const xRatio = x / DON_FINGERPRINT_WIDTH
      const yRatio = y / DON_FINGERPRINT_HEIGHT
      const insideArt = xRatio >= 0.05 && xRatio <= 0.95 && yRatio >= 0.04 && yRatio <= 0.72
      const lowerRulesArea = yRatio > 0.72
      const weight = insideArt ? 1.65 : lowerRulesArea ? 0.55 : 0.8
      const offset = (y * DON_FINGERPRINT_WIDTH + x) * 3

      for (let channel = 0; channel < 3; channel += 1) {
        const normalizedQuery = query[offset + channel] - queryMeans[channel]
        const normalizedCandidate = candidate[offset + channel] - candidateMeans[channel]
        const structure = Math.abs(normalizedQuery - normalizedCandidate)
        const rawColor = Math.abs(query[offset + channel] - candidate[offset + channel])
        difference += (structure * 0.78 + rawColor * 0.22) * weight
        totalWeight += weight
      }
    }
  }

  return totalWeight > 0 ? difference / totalWeight : Number.POSITIVE_INFINITY
}
