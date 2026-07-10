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

      const metadataUsername = typeof user.user_metadata?.username === 'string'
        ? user.user_metadata.username.trim()
        : ''

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
            username: metadataUsername || null,
            username_locked: Boolean(metadataUsername)
          })

        if (insertError) {
          console.log('PROFILE ERROR:', insertError.message)
        }
      } else if (!profileData.username && metadataUsername) {
        await supabase
          .from('profiles')
          .update({
            username: metadataUsername,
            username_locked: true
          })
          .eq('id', user.id)
      }

      const firstAccess = !(profileData?.username || metadataUsername)
      router.replace(firstAccess ? '/complete-profile' : '/bacheca')
    }

    handle()
  }, [router])

  return (
    <div className="text-white flex items-center justify-center min-h-screen onepiece-bg onepiece-clouds">
      Login in corso...
    </div>
  )
}
