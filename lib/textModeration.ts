export const MODERATION_REJECTION_MESSAGE = 'Il testo contiene parole o espressioni non consentite.'

const blockedTerms = [
  'cazzo', 'cazzone', 'coglione', 'coglioni', 'stronzo', 'stronza', 'merda',
  'puttana', 'troia', 'vaffanculo', 'bastardo', 'bastarda', 'cretino', 'cretina',
  'imbecille', 'idiota', 'deficiente', 'ritardato', 'ritardata', 'mongoloide',
  'frocio', 'finocchio', 'negro', 'suca', 'porco dio', 'dio cane', 'dio porco',
  'madonna puttana', 'figlio di puttana', 'fuck', 'fucker', 'motherfucker', 'shit',
  'bitch', 'asshole', 'cunt', 'nigger', 'faggot'
]

const leetCharacters: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'i'
}

const normalizeCharacters = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split('')
    .map(character => leetCharacters[character] || character)
    .join('')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const collapseRepeats = (value: string) => value.replace(/([a-z])\1+/g, '$1')
const compact = (value: string) => collapseRepeats(normalizeCharacters(value).replace(/\s/g, ''))

const blockedTokens = new Set(blockedTerms
  .filter(term => !term.includes(' '))
  .map(term => collapseRepeats(normalizeCharacters(term))))

const blockedCompacts = blockedTerms
  .map(compact)
  .filter(term => term.length >= 4)

export const containsBlockedLanguage = (value: string) => {
  const normalized = normalizeCharacters(value)
  if (!normalized) return false

  const tokens = normalized
    .split(' ')
    .map(collapseRepeats)
    .filter(Boolean)

  if (tokens.some(token => blockedTokens.has(token))) return true

  const compactValue = collapseRepeats(normalized.replace(/\s/g, ''))
  return blockedCompacts.some(term => compactValue.includes(term))
}

export const validateUserText = (value: string) => ({
  ok: !containsBlockedLanguage(value),
  message: MODERATION_REJECTION_MESSAGE
})
