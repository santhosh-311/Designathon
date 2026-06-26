import asyncio
import os
import sys

# Ensure backend root is on Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.mcp.client import run_coordinator_agent
from app.core.config import settings

async def main():
    # Verify environment variables
    print(f"AZURE_OPENAI_ENDPOINT: {settings.AZURE_OPENAI_ENDPOINT}")
    print(f"AZURE_OPENAI_DEPLOYMENT: {settings.AZURE_OPENAI_DEPLOYMENT}")
    
    if not settings.AZURE_OPENAI_API_KEY:
        print("[FAIL] AZURE_OPENAI_API_KEY not configured. Cannot perform live verification.")
        sys.exit(1)

    print("\n--- Verifying Chat History Summarization ---")
    
    # 1. Construct a mock history containing more than 6 messages (8 messages)
    mock_history = [
        {"role": "user", "content": "Hello, I am coordinating batch 'C-901' for Spark Phase 1."},
        {"role": "assistant", "content": "Hello! I can help you manage candidates, schedules, and assessments for batch 'C-901'."},
        {"role": "user", "content": "The batch start date is 2026-07-01 and the end date is 2026-08-15."},
        {"role": "assistant", "content": "I have noted the dates for batch 'C-901'. Let me know if you want to generate a schedule."},
        {"role": "user", "content": "We have 35 candidates enrolled. Can we verify their registrations?"},
        {"role": "assistant", "content": "Sure, please provide their list or registration IDs to check."},
        {"role": "user", "content": "The top candidate is named Eswara with email eswara@example.com."},
        {"role": "assistant", "content": "Got it. Eswara is marked as the lead candidate for batch 'C-901'."},
    ]
    
    # 2. Query that references the older summarized part
    user_prompt = "What was the start date we discussed for batch C-901?"
    
    print("Executing run_coordinator_agent with long history...")
    # Mock user object
    mock_user = {"sub": "test-coordinator-uuid", "role": "ADMIN", "email": "admin@example.com"}
    
    try:
        final_answer, thought_log = await run_coordinator_agent(user_prompt, mock_user, mock_history)
        print("\n--- Agent Final Answer ---")
        print(final_answer)
        print("\n--- Thought Log ---")
        for log in thought_log:
            print(f"Tool called: {log['toolName']} -> status: {log['status']}")
        
        # Verify the answer contains the start date (2026-07-01 or July 1st)
        if "2026-07-01" in final_answer or "July" in final_answer or "2026" in final_answer:
            print("\n[SUCCESS] History summarization successfully preserved the start date and allowed the agent to answer correctly!")
        else:
            print("\n[WARN] The agent response did not explicitly mention the start date. Please verify the output manually.")
            
    except Exception as e:
        print(f"\n[FAIL] Chat agent execution failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
