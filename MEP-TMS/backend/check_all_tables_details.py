import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

tables = [
    "assessments",
    "attendances",
    "batches",
    "candidates",
    "detailed_feedbacks",
    "feedbacks",
    "foundation_report_cards",
    "gamification_ledger",
    "notifications",
    "spark_1_report_cards",
    "spark_2_report_cards",
    "stream_report_cards",
    "trainee_pool",
    "users"
]

print("--- Detailed Table Record Counts ---")
for t in tables:
    try:
        res = supabase.rpc("execute_sql", {"sql_query": f"SELECT count(*) as cnt FROM {t}"}).execute()
        count = res.data[0]['cnt'] if res.data else 0
        print(f"Table '{t}': {count} records")
    except Exception as e:
        print(f"Table '{t}': Error: {e}")
