export type OpvOptimizerLesson = {
  productId: number
  group: string
  evidence: 'visual_high' | 'visual_reviewed'
  similarity: number
}

// These mappings were compared against the actual Cardmarket product image.
// They are durable regression knowledge: daily price syncs may change the
// value, but must never silently switch the selected printing.
export const OPV_CARDMARKET_OPTIMIZER_LESSONS: Record<string, OpvOptimizerLesson> = {
  'OP01-006_P1': { productId: 729803, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.8823 },
  'OP01-006_R1': { productId: 690798, group: 'optimizer-01-critical', evidence: 'visual_reviewed', similarity: 0.9361 },
  'OP01-016_P2': { productId: 698921, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9441 },
  'OP01-016_P5': { productId: 740389, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9909 },
  'OP01-016_P7': { productId: 778601, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.8903 },
  'OP02-106_P1': { productId: 708384, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9883 },
  'OP02-106_P6': { productId: 768064, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9316 },
  'OP03-116_P2': { productId: 794716, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9909 },
  'OP03-116_P7': { productId: 787481, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9347 },
  'OP03-116_P8': { productId: 737462, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9876 },
  'OP04-100_P4': { productId: 732805, group: 'optimizer-01-critical', evidence: 'visual_reviewed', similarity: 0.8024 },
  'OP09-004_P2': { productId: 802866, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9917 },
  'OP09-004_P3': { productId: 802865, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9896 },
  'OP09-004_P4': { productId: 840738, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9903 },
  'OP09-004_R1': { productId: 802863, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9897 },
  'OP09-076_P1': { productId: 818274, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9922 },
  'OP12-020_P2': { productId: 852787, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9894 },
  'OP12-020_P4': { productId: 874225, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.8917 },
  'ST01-006_P1': { productId: 717515, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9828 },
  'ST01-006_P2': { productId: 698922, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9336 },
  'ST01-006_P3': { productId: 740385, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9235 },
  'ST01-006_P4': { productId: 778618, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.8210 },
  'ST03-008_P1': { productId: 740392, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9780 },
  'ST03-008_P2': { productId: 762653, group: 'optimizer-01-critical', evidence: 'visual_high', similarity: 0.9919 },
}

export const getOpvOptimizerLesson = (variantId?: string | null) => (
  OPV_CARDMARKET_OPTIMIZER_LESSONS[String(variantId || '').trim().toUpperCase()] || null
)
