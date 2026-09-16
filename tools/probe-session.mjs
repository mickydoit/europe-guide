// Creates a signed-in session for the owner and writes the URL fragment supabase-js accepts to argv[2].
// Usage: node tools/probe-session.mjs /tmp/frag.txt   (needs SUPABASE_SERVICE_KEY in .env; never prints tokens)
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\r/g, '')] }))
const email = process.argv[3] ?? 'housestudio.sc@gmail.com'
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (error) { console.error('generateLink failed:', error.message); process.exit(1) }
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const v = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
if (v.error) { console.error('verifyOtp failed:', v.error.message); process.exit(1) }
const s = v.data.session
writeFileSync(process.argv[2], `access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=${s.expires_in}&token_type=bearer&type=magiclink`)
console.log('session written')
