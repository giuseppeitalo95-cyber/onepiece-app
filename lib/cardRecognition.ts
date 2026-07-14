const normalizeOcrNumber = (value: string) =>
  value
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^0-9]/g, '')

export const parseCardCodeFromText = (text: string) => {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const codeMatch = compact.match(/(OP|0P|ST|EB|PRB|SP|EX|CP)([0-9OILSB]{1,2})([0-9OILSB]{3})/)

  if (codeMatch) {
    const prefix = codeMatch[1].replace('0P', 'OP')
    const setNumber = normalizeOcrNumber(codeMatch[2]).padStart(2, '0')
    const cardNumber = normalizeOcrNumber(codeMatch[3]).padStart(3, '0')
    if (setNumber && cardNumber) return `${prefix}${setNumber}-${cardNumber}`
  }

  const donMatch = compact.match(/D[O0]N([0-9OILSB]{3})/)
  if (donMatch) {
    const cardNumber = normalizeOcrNumber(donMatch[1]).padStart(3, '0')
    if (cardNumber) return `DON-${cardNumber}`
  }

  const promoMatch = compact.match(/P([0-9OILSB]{3})/)
  if (promoMatch) {
    const cardNumber = normalizeOcrNumber(promoMatch[1]).padStart(3, '0')
    if (cardNumber) return `P-${cardNumber}`
  }

  return null
}
