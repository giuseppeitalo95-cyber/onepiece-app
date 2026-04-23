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
      const { data: profileData } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle()

      if (!profileData) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            username: null,
            username_locked: false
          })

        if (insertError) {
          console.log('PROFILE ERROR:', insertError.message)
        }
      }

      const firstAccess = !profileData?.username
      router.replace(firstAccess ? '/profile' : '/dashboard')
    }

    handle()
  }, [])

  return (
    <div className="text-white flex items-center justify-center min-h-screen onepiece-bg onepiece-clouds">
      Login in corso...
    </div>
  )
}