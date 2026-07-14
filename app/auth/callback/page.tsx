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
        .select('username, username_locked')
        .eq('id', user.id)
        .maybeSingle()

      const unlockValentinaNickname = profileData?.username?.trim().toLocaleLowerCase('it-IT') === 'valentina tempesta'

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
      } else if (unlockValentinaNickname && profileData.username_locked !== false) {
        await supabase
          .from('profiles')
          .update({ username_locked: false })
          .eq('id', user.id)
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
      router.replace(firstAccess ? '/complete-profile' : unlockValentinaNickname ? '/profile' : '/dashboard')
    }

    handle()
  }, [router])

  return (
    <div className="text-white flex items-center justify-center min-h-screen onepiece-bg onepiece-clouds">
      Login in corso...
    </div>
  )
}
