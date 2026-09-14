import { redirect } from 'next/navigation'
import { PREMIUM_FEATURES_ENABLED } from '@/lib/premium'

export default function PremiumLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Preserve every Premium page for a future relaunch without exposing the
  // subscription flow while plans are disabled.
  if (!PREMIUM_FEATURES_ENABLED) redirect('/profile')
  return children
}
