import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

sql = "SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid = pg_proc.pronamespace WHERE n.nspname = 'public'"

try:
    res = supabase.rpc("execute_sql", {"sql_query": sql}).execute()
    print("Functions:")
    for row in res.data:
        print(row)
except Exception as e:
    print("Error:", e)
