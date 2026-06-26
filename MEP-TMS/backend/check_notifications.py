import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

sql = "SELECT id, type, message, recipient_id FROM notifications LIMIT 10"

try:
    res = supabase.rpc("execute_sql", {"sql_query": sql}).execute()
    print("Sample notifications:")
    for row in res.data or []:
        print(f" - ID: {row.get('id')} | Type: {row.get('type')} | Recipient: {row.get('recipient_id')} | Msg: {row.get('message')}")
except Exception as e:
    print("Failed to run SQL RPC:", e)
