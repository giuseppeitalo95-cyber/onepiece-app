'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Callback() {
  const router = useRouter()

  useEffect(() => {
    const handle = async () => {

      const { data, error } = await supabase.auth.getUser()

      const user = data?.user

      if (error || !user) {
        router.replace('/')
        return
      }

      // 🔥 CREA SOLO IL PROFILO BASE (NO GOOGLE NAME)
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: user.id,
            username: null
          },
          { onConflict: 'id' }
        )

      if (upsertError) {
        console.log('PROFILE ERROR:', upsertError.message)
      }

      router.replace('/dashboard')
    }

    handle()
  }, [])

  return (
    <div className="text-white flex items-center justify-center min-h-screen onepiece-bg">
      Login in corso...
    </div>
  )
}