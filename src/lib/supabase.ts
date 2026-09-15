import { createClient } from '@supabase/supabase-js'
const url = (import.meta.env.VITE_SUPABASE_URL as string) || undefined
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || undefined
if (!url || !key) console.warn('Supabase env missing; auth will fail')
export const supabase = createClient(url ?? 'http://localhost', key ?? 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
})
