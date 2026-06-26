import os
import sys
import json
import httpx
from typing import List, Dict, Any, Tuple
from datetime import datetime

# Add the project root directory to the python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.config import settings
from app.mcp.server import call_tool, list_tools

async def get_mcp_tools_schemas(current_user: dict = None) -> List[Dict[str, Any]]:
    """Retrieve tool definitions from the MCP server and format them for OpenAI API."""
    tools_list = await list_tools(current_user)
    openai_tools = []
    for tool in tools_list:
        openai_tools.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.inputSchema
            }
        })
    return openai_tools

async def run_coordinator_agent(user_prompt: str, current_user: dict, chat_history: List[Dict[str, Any]] = None) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Run the coordinator assistant agent loop using Azure OpenAI.
    Translates user query -> Azure OpenAI -> MCP Server Tool executions -> Final response.
    Returns:
        Tuple[final_response_text, list_of_executed_tool_calls_for_thought_logs]
    """
    from openai import AsyncOpenAI
    
    mcp_tools = await get_mcp_tools_schemas(current_user)
    
    # Initialize message list
    messages = []
    
    # Add system instructions
    role = current_user.get("role", "COORDINATOR") if current_user else "COORDINATOR"
    user_id = current_user.get("sub") or current_user.get("email") or ""
    persona = "Admin" if role == "ADMIN" else "Coordinator"
    
    # Retrieve allowed batch IDs for coordinator to inject into instructions
    allowed_batches_context = ""
    if role == "COORDINATOR":
        try:
            from app.core.database import get_db
            from app.models.models import row_to_api
            db_instance = get_db()
            if db_instance:
                res = db_instance.table("batches").select("*").execute()
                batches = [row_to_api(row) for row in res.data] if res.data else []
                
                trainer_name = ""
                try:
                    user_res = db_instance.table("users").select("full_name").eq("id", user_id).execute()
                    if user_res.data:
                        trainer_name = user_res.data[0]["full_name"]
                except Exception:
                    pass
                trainer_clean = trainer_name.strip().lower() if trainer_name else ""
                user_email_clean = current_user.get("email", "").strip().lower() if current_user else ""
                
                allowed_ids = []
                for b in batches:
                    creator = b.get("createdBy")
                    is_original = not creator and user_id in ["df772f20-b396-4a3b-8ddc-68fcd54b6060", "728f45b3-f6bd-4cfa-860f-a42c89682b33"]
                    is_owner = creator == user_id or is_original
                    
                    trainers = b.get("trainers", []) or []
                    is_trainer = False
                    for t in trainers:
                        t_clean = t.strip().lower()
                        if (trainer_clean and t_clean == trainer_clean) or t_clean == user_email_clean:
                            is_trainer = True
                            break
                    
                    if is_owner or is_trainer:
                        allowed_ids.append(f"'{b.get('id')}' ({b.get('batchName')})")
                if allowed_ids:
                    allowed_batches_context = f"\nYour allowed batch IDs are: {', '.join(allowed_ids)}.\n"
        except Exception:
            pass

    system_instruction = (
        f"You are an expert AI {persona} Assistant for Maverick Execution Platform (MEP-TMS). "
        f"You assist batch {persona.lower()}s with administration, candidate management, communication, and reporting. "
        "You have direct access to a set of database, email, and Excel tools via Model Context Protocol (MCP).\n\n"
        "Instructions:\n"
        "1. Always use the appropriate tool when the user asks for batch listings, summaries, toppers, email alerts, or candidate records.\n"
        "2. To answer complex questions about the database, you can write and execute raw read-only SQL queries using the `execute_readonly_sql` tool. "
        "Before writing any query, you should call `get_db_schema` to inspect the available tables, columns, and relationships.\n"
        "3. Present query results clearly and professionally using beautifully formatted markdown tables or lists. Do not show raw JSON to the user. "
        "Summarize key insights, averages, counts, or topper details as requested.\n"
        f"4. If the {persona.lower()} asks to import trainees from an Excel file, ask for the local file path (or use the uploaded file path) and call `parse_and_import_excel_candidates`.\n"
        "5. If a tool fails or throws a security violation, explain the error to the user gracefully.\n"
        "6. Keep responses professional, helpful, and concise.\n\n"
        "Database Execution Security:\n"
        "- Only read-only queries (SELECT, WITH, SHOW, EXPLAIN) are allowed.\n"
    )
    if role == "COORDINATOR":
        system_instruction += (
            f"Coordinator Access Restrictions:{allowed_batches_context}"
            "- You can ONLY access data related to your assigned batches.\n"
            "- When querying batch-specific tables (such as `candidates`, `attendances`, `assessments`, `feedbacks`, `detailed_feedbacks`, report cards, etc.), "
            "you MUST always include a filter on `batch_id` matching your allowed batch UUID(s) (e.g. `WHERE batch_id = '...'` or `WHERE batch_id IN ('...', '...')`).\n"
            "- Any query that does not filter by your allowed batch ID(s) or your own user ID will be blocked by the server security layer."
        )
    raw_client = AsyncOpenAI(
        api_key=settings.AZURE_OPENAI_API_KEY,
        base_url=settings.AZURE_OPENAI_ENDPOINT
    )
    if settings.LANGCHAIN_TRACING_V2.lower() == "true":
        from langsmith.wrappers import wrap_openai
        client = wrap_openai(raw_client)
    else:
        client = raw_client

    # ── History Summarization ───────────────────────────────────────────────
    summarized_history = ""
    recent_history = []
    
    if chat_history and len(chat_history) > 6:
        # Keep the last 4 messages as active context, summarize the rest
        messages_to_summarize = chat_history[:-4]
        recent_history = chat_history[-4:]
        
        try:
            summary_prompt = (
                "You are an AI system assistant. Summarize the following previous conversation history between "
                "the User and the Assistant in a single concise paragraph. Focus on the main topics discussed, "
                "specific batch IDs, and database queries executed. Keep the summary dense, short, and technical:\n\n"
            )
            for msg in messages_to_summarize:
                role_label = "User" if msg['role'] == "user" else "Assistant"
                summary_prompt += f"{role_label}: {msg['content']}\n"
                
            # Perform summarization using Azure OpenAI client
            summary_res = await raw_client.chat.completions.create(
                model=settings.AZURE_OPENAI_DEPLOYMENT,
                messages=[{"role": "user", "content": summary_prompt}],
                temperature=0.1,
                max_completion_tokens=250
            )
            summarized_history = summary_res.choices[0].message.content or ""
        except Exception as e:
            print(f"[Error] Failed to summarize chat history: {e}. Falling back to full history.")
            recent_history = chat_history
    elif chat_history:
        recent_history = chat_history

    # Assemble messages list ensuring static instructions are at the beginning for prompt prefix caching
    messages = []
    messages.append({"role": "system", "content": system_instruction})
    
    if summarized_history:
        messages.append({
            "role": "system",
            "content": f"The following is a summary of the earlier part of this conversation:\n{summarized_history}"
        })
        
    for h in recent_history:
        messages.append({
            "role": h["role"],
            "content": h["content"]
        })
        
    messages.append({
        "role": "user",
        "content": user_prompt
    })

    
    executed_tools_log = []
    loop_count = 0
    max_loops = 5  # Prevent infinite agent loops

    while loop_count < max_loops:
        loop_count += 1
        
        # 1. Ask Azure OpenAI
        response = await client.chat.completions.create(
            model=settings.AZURE_OPENAI_DEPLOYMENT,
            messages=messages,
            tools=mcp_tools if mcp_tools else None,
            temperature=0.2
        )
        
        message = response.choices[0].message
        
        # Build assistant message to add to messages history
        assistant_msg = {
            "role": "assistant",
            "content": message.content or ""
        }
        if message.tool_calls:
            assistant_msg["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": tc.type,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                } for tc in message.tool_calls
            ]
            
        messages.append(assistant_msg)
        
        # 2. If no tool calls, agent has finished reasoning and returned final text
        if not message.tool_calls:
            return message.content or "", executed_tools_log
            
        # 3. Handle tool calls
        for tc in message.tool_calls:
            tool_name = tc.function.name
            try:
                tool_args = json.loads(tc.function.arguments)
            except Exception:
                tool_args = {}
            
            # Log for thought drawer
            executed_tools_log.append({
                "toolName": tool_name,
                "arguments": tool_args,
                "status": "running",
                "timestamp": datetime.utcnow().isoformat()
            })
            
            # Execute the tool via our MCP Server implementation
            try:
                mcp_response = await call_tool(tool_name, tool_args, current_user)
                tool_output = ""
                if mcp_response and len(mcp_response) > 0:
                    tool_output = mcp_response[0].text
                else:
                    tool_output = "Success (No content returned)"
                
                # Update status to success
                executed_tools_log[-1]["status"] = "success"
                executed_tools_log[-1]["result"] = tool_output
            except Exception as tool_ex:
                tool_output = f"Error executing tool: {str(tool_ex)}"
                executed_tools_log[-1]["status"] = "failed"
                executed_tools_log[-1]["result"] = tool_output
                
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": tool_name,
                "content": tool_output
            })

    return "Agent loop exceeded maximum execution steps.", executed_tools_log
