export const ADMIN_ACCOUNT = {
  id: 'fcade84e-6413-4009-91df-a8c839a170cc',
  email: 'giuseppeitalo95@gmail.com',
  username: 'peppitalo'
}

export const isAdminAccount = (
  user?: { id?: string | null; email?: string | null } | null,
  _profile?: { username?: string | null } | null
) => {
  // The immutable Supabase Auth UUID is the only admin credential. Email,
  // nickname and editable profile fields must never grant admin access.
  return Boolean(user?.id && user.id === ADMIN_ACCOUNT.id)
}
