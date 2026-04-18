/**
 * Client Supabase partagé pour toute l'application.
 *
 * L'URL et la clé publishable sont destinées à être embarquées côté client —
 * elles sont protégées par les Row Level Security (RLS) policies définies
 * côté Supabase. Voir SUPABASE_SETUP.md pour la configuration du dashboard.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rppyxqnfuhkguozrudbe.supabase.co'
const SUPABASE_KEY = 'sb_publishable_of3CMZSp88oNAW2TnD9Qyw_HpyuPBYs'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
