export const ADMIN_ACCOUNT = {
  id: 'fcade84e-6413-4009-91df-a8c839a170cc',
  email: 'giuseppeitalo95@gmail.com',
  username: 'peppitalo'
}

const clean = (value?: string | null) => (value || '').trim().toLowerCase()

export const isAdminAccount = (
  user?: { id?: string | null; email?: string | null } | null,
  profile?: { username?: string | null } | null
) => {
  if (!user) return false

  const emailMatches = clean(user.email) === ADMIN_ACCOUNT.email
  const idMatches = user.id === ADMIN_ACCOUNT.id
  const username = clean(profile?.username)
  const usernameMatches = username === ADMIN_ACCOUNT.username

  return emailMatches || (idMatches && (usernameMatches || !username))
}
