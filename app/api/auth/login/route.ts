import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()

    if (!username || !password) {
      return Response.json(
        { error: 'Username e password sono obbligatori' },
        { status: 400 }
      )
    }

    const supabase = createClient(
      'https://jxwgbzatdueefdiyxlns.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ'
    )

    // 1. Cerca l'utente con questo username nel database
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username.trim())
      .single()

    if (profileError || !profileData) {
      return Response.json(
        { error: 'Username o password errati' },
        { status: 401 }
      )
    }

    // 2. Prendi l'email associata a questo user id
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profileData.id)

    if (userError || !userData.user) {
      return Response.json(
        { error: 'Username o password errati' },
        { status: 401 }
      )
    }

    const email = userData.user.email

    if (!email) {
      return Response.json(
        { error: 'Email non trovata' },
        { status: 401 }
      )
    }

    // 3. Login con email e password
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (authError) {
      return Response.json(
        { error: 'Username o password errati' },
        { status: 401 }
      )
    }

    return Response.json({
      message: 'Login completato',
      user: authData.user,
      session: authData.session
    }, { status: 200 })

  } catch (error) {
    console.error('Login error:', error)
    return Response.json(
      { error: 'Errore server' },
      { status: 500 }
    )
  }
}
