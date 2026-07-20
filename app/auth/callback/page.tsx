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

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        await fetch('/api/auth/registration', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }).catch(() => undefined)
      }

      const firstAccess = !profileData?.username
      router.replace(firstAccess ? '/complete-profile' : '/dashboard')
    }

    handle()
  }, [router])

  return (
    <div className="text-white flex items-center justify-center min-h-screen onepiece-bg onepiece-clouds">
      Login in corso...
    </div>
  )
}
