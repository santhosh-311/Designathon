import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

migration_file = "gamification_migration.sql"
if not os.path.exists(migration_file):
    migration_file = os.path.join(os.path.dirname(__file__), migration_file)

with open(migration_file, "r") as f:
    sql = f.read()

# Add schema reload command
sql += "\nNOTIFY pgrst, 'reload schema';"

print("Running gamification migration SQL via execute_sql RPC...")
try:
    res = supabase.rpc("execute_sql", {"sql_query": sql}).execute()
    print("Migration executed successfully!")
    print("Response data:", res.data)
except Exception as e:
    print("Migration failed:", e)
