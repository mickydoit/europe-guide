import 'dotenv/config'
export function loadEnv() {
  const need = ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OWNER_USER_ID', 'GOOGLE_SERVER_KEY', 'PROTOMAPS_BUILD_URL'] as const
  const missing = need.filter(k => !process.env[k]); if (missing.length) throw new Error(`.env missing: ${missing.join(', ')}`)
  return { supabaseUrl: process.env.VITE_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY!, ownerId: process.env.OWNER_USER_ID!, googleServerKey: process.env.GOOGLE_SERVER_KEY!, protomapsBuildUrl: process.env.PROTOMAPS_BUILD_URL! }
}
