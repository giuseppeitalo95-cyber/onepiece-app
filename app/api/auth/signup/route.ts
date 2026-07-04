import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const { username, email, password } = await req.json()

    if (!username || !email || !password) {
      return Response.json(
        { error: 'Username, email e password sono obbligatori' },
        { status: 400 }
      )
    }

    if (username.length < 3) {
      return Response.json(
        { error: 'Username deve essere almeno 3 caratteri' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return Response.json(
        { error: 'Password deve essere almeno 6 caratteri' },
        { status: 400 }
      )
    }

    const supabase = createClient(
      'https://jxwgbzatdueefdiyxlns.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ'
    )

    // 1. Crea l'utente con Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) {
      console.error('Auth error:', authError)
      return Response.json(
        { error: authError.message || 'Errore registrazione' },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return Response.json(
        { error: 'Errore creazione utente' },
        { status: 400 }
      )
    }

    // 2. Crea il profilo con lo username
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        username: username.trim(),
        username_locked: false
      })

    if (profileError) {
      console.error('Profile error:', profileError)
      // Prova a cancellare l'utente auth se il profilo non è stato creato
      await supabase.auth.admin.deleteUser(authData.user.id)
      return Response.json(
        { error: 'Errore creazione profilo' },
        { status: 400 }
      )
    }

    return Response.json({
      message: 'Registrazione completata. Controlla l\'email per confermare.',
      user: authData.user.id
    }, { status: 201 })

  } catch (error) {
    console.error('Signup error:', error)
    return Response.json(
      { error: 'Errore server' },
      { status: 500 }
    )
  }
}
