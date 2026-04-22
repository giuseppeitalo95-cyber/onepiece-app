import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://jxwgbzatdueefdiyxlns.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
)