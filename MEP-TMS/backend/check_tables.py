import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

# No trailing semicolon!
sql = "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"

try:
    res = supabase.rpc("execute_sql", {"sql_query": sql}).execute()
    print("Type of res.data:", type(res.data))
    print("res.data:", res.data)
except Exception as e:
    print("Failed to run SQL RPC:", e)
