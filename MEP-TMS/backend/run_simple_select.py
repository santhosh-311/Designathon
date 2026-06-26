import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

sql = "SELECT 1 as val;"

try:
    res = supabase.rpc("execute_sql", {"sql_query": sql}).execute()
    print("res.data type:", type(res.data))
    print("res.data:", res.data)
except Exception as e:
    print("Error:", e)
