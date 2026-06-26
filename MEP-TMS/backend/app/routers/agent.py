from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks
from typing import List, Optional, TypedDict
from app.core.database import get_db
from app.core.security import get_current_user, has_role
from app.models.models import Batch, row_to_api
from app.schemas.schemas import BatchResponse
from pydantic import BaseModel, Field
import json
import asyncio
from datetime import datetime

router = APIRouter(prefix="/api/agent", tags=["agent"])

# ============ Schemas ============
class AgentCreateRequest(BaseModel):
    agentName: str
    modelName: str
    temperature: float = 0.7
    promptInstruction: Optional[str] = None
    additionalInstruction: Optional[str] = None
    selectedDays: Optional[List[int]] = None  # Day numbers from the targets timeline the AI should teach

class Slide(BaseModel):
    title: str = Field(description="The title of the slide (e.g. 'Lesson Objectives', 'Core Concepts', 'Code Examples', 'Key takeaways')")
    bullets: List[str] = Field(description="3 to 5 bullet points explaining this slide's core concepts. Code snippets can be formatted in markdown code blocks.")

class TopicSubtopicSlides(BaseModel):
    name: str = Field(description="The name of the subtopic")
    slides: List[Slide] = Field(description="List of slides. MUST start with 'Lesson Objectives' and end with 'Key takeaways'. Must have 2-4 content slides in between.")

class TopicSlides(BaseModel):
    subtopics: List[TopicSubtopicSlides] = Field(description="List of slides grouped by subtopic")

# ============ Helpers ============
def parse_batch_topics(topics_list: List[str]) -> List[dict]:
    parsed_topics = []
    for topic_str in topics_list:
        if ":" in topic_str:
            parts = topic_str.split(":", 1)
            topic_name = parts[0].strip()
            subtopics_str = parts[1]
            subtopics = [s.strip() for s in subtopics_str.split(",") if s.strip()]
            parsed_topics.append({
                "name": topic_name,
                "subtopics": subtopics
            })
        else:
            parsed_topics.append({
                "name": topic_str.strip(),
                "subtopics": ["General Concepts"]
            })
    return parsed_topics


def extract_topics_from_timeline(targets: List[dict], selected_days: List[int]) -> List[dict]:
    """Extract unique topics/subtopics from the targets timeline for only the selected day numbers.
    Returns a list of {name, subtopics, dayNumbers} dicts suitable for slide generation."""
    topic_map = {}  # topic_name -> {subtopics: set, dayNumbers: list}
    
    for week in targets:
        for day in week.get("days", []):
            day_num = day.get("day_number")
            if day_num not in selected_days:
                continue
            topic_name = day.get("topic", "General")
            subtopics_list = day.get("subtopics", [])
            
            if topic_name not in topic_map:
                topic_map[topic_name] = {"subtopics": set(), "dayNumbers": []}
            
            topic_map[topic_name]["dayNumbers"].append(day_num)
            for sub in subtopics_list:
                topic_map[topic_name]["subtopics"].add(sub)
    
    result = []
    for name, data in topic_map.items():
        result.append({
            "name": name,
            "subtopics": list(data["subtopics"]) if data["subtopics"] else ["Core concepts and practical exercises"],
            "dayNumbers": sorted(data["dayNumbers"])
        })
    return result

# ============ Langgraph State & Workflow ============
class AgentState(TypedDict):
    batch_name: str
    topics: List[dict]
    model_name: str
    temperature: float
    prompt_instruction: Optional[str]
    additional_instruction: Optional[str]
    generated_content: List[dict]

async def generate_all_slides_node(state: AgentState):
    batch_name = state["batch_name"]
    model_name = state["model_name"]
    temperature = state["temperature"]
    prompt_instruction = state["prompt_instruction"]
    additional_instruction = state["additional_instruction"]
    topics = state["topics"]
    
    default_base_prompt = """You are an elite technical instructor and an expert in computer science pedagogy.
Your task is to generate highly educational, structured, and visually engaging training slides."""

    base_prompt = prompt_instruction.strip() if prompt_instruction and prompt_instruction.strip() else default_base_prompt
    additional_prompt = additional_instruction.strip() if additional_instruction and additional_instruction.strip() else ""

    from langchain_openai import ChatOpenAI
    from app.core.config import settings
    
    # Resolve the model name, falling back to the configured deployment name if old gemini selection is present
    resolved_model = settings.AZURE_OPENAI_DEPLOYMENT
    if model_name and not model_name.startswith("gemini"):
        resolved_model = model_name

    # Initialize the Azure OpenAI model via Langchain
    llm = ChatOpenAI(
        model=resolved_model,
        api_key=settings.AZURE_OPENAI_API_KEY,
        base_url=settings.AZURE_OPENAI_ENDPOINT,
        temperature=temperature
    )
    
    # Enforce structured output matching the TopicSlides schema
    structured_llm = llm.with_structured_output(TopicSlides)
    
    # Concurrency limit to avoid API rate limits
    sem = asyncio.Semaphore(3)
    
    async def process_topic(topic_item: dict):
        topic_name = topic_item["name"]
        subtopic_names = topic_item["subtopics"]
        day_numbers = topic_item.get("dayNumbers", [])
        
        async with sem:
            prompt = f"""{base_prompt}
            
            Batch Context: {batch_name}
            Topic Group: {topic_name}
            Subtopics to generate slides for: {', '.join(subtopic_names)}
            
            {f"Additional instructions: {additional_prompt}" if additional_prompt else ""}
            
            For EACH subtopic in the list, you MUST generate a complete slide deck under the corresponding Subtopic entry.
            
            Slide Structure Requirements (per Subtopic):
            - SLIDE 1 (Must be titled exactly "Lesson Objectives"): Outline the specific learning outcomes for this subtopic in 3-5 concise bullets.
            - SLIDES 2 to N (Content Slides, 2-3 slides): Break down the concept step-by-step. Keep explanations extremely concise to save tokens. Use short bullets. Provide clean code snippets in markdown format (using code blocks) on separate lines with newlines.
            - FINAL SLIDE (Must be titled exactly "Key takeaways"): Highlight the 3-5 critical takeaways from this subtopic.
            """
            
            try:
                result = await structured_llm.ainvoke(prompt)
                subtopic_contents = []
                for sub in result.subtopics:
                    slides_list = []
                    for s in sub.slides:
                        slides_list.append({
                            "title": s.title,
                            "bullets": s.bullets
                        })
                    subtopic_contents.append({
                        "name": sub.name,
                        "slides": slides_list
                    })
                
                # Check for missing subtopics and add placeholder fallback
                generated_names = {s["name"].lower() for s in subtopic_contents}
                for original_sub in subtopic_names:
                    if original_sub.lower() not in generated_names:
                        subtopic_contents.append({
                            "name": original_sub,
                            "slides": [
                                {
                                    "title": "Lesson Objectives",
                                    "bullets": [f"Understand {original_sub}", "Learn core concepts of this subtopic"]
                                },
                                {
                                    "title": "Core Concepts",
                                    "bullets": ["Slide content generation skipped. Please check course resources."]
                                },
                                {
                                    "title": "Key takeaways",
                                    "bullets": [f"Review {original_sub} documentation"]
                                }
                            ]
                        })
            except Exception as e:
                print(f"[Error] AI slide generation failed for topic group '{topic_name}': {e}")
                # Fallback to avoid complete failure
                subtopic_contents = []
                for sub in subtopic_names:
                    subtopic_contents.append({
                        "name": sub,
                        "slides": [
                            {
                                "title": "Lesson Objectives",
                                "bullets": [f"Understand {sub}", "Learn core concepts of this subtopic"]
                            },
                            {
                                "title": "Core Concepts",
                                "bullets": ["Due to an AI service interruption, content generation was skipped.", "Please trigger re-generation of the agent to fetch slides."]
                            },
                            {
                                "title": "Key takeaways",
                                "bullets": [f"Review {sub} documentation", "Experiment with code locally"]
                            }
                        ]
                    })
        
        result = {
            "topic": topic_name,
            "subtopics": subtopic_contents
        }
        if day_numbers:
            result["dayNumbers"] = day_numbers
        return result

    # Parallel generation across all topic groups (now only 7 calls instead of 35!)
    topic_tasks = [process_topic(t) for t in topics]
    generated_content = await asyncio.gather(*topic_tasks)
    
    return {"generated_content": generated_content}

# Compile Langgraph Workflow Graph
from langgraph.graph import StateGraph, START, END

workflow = StateGraph(AgentState)
workflow.add_node("generate_content", generate_all_slides_node)
workflow.add_edge(START, "generate_content")
workflow.add_edge("generate_content", END)
graph = workflow.compile()

async def bg_generate_slides(batch_id: str, initial_state: dict, batch_name: str):
    # This runs in background
    try:
        from app.core.database import get_db
        db = get_db()
        
        # 1. Run Langgraph Workflow
        output = await graph.ainvoke(initial_state)
        generated_slides = output.get("generated_content", [])
        
        # 2. Fetch latest batch row
        batch_result = db.table("batches").select("*").eq("id", batch_id).execute()
        if not batch_result.data:
            return
            
        batch_row = batch_result.data[0]
        desc_str = batch_row.get("description")
        desc_json = {}
        if desc_str:
            try:
                desc_json = json.loads(desc_str)
            except Exception:
                desc_json = {"text": desc_str}
                
        # 3. Update agent content and status
        if "agent" in desc_json:
            desc_json["agent"]["content"] = generated_slides
            desc_json["agent"]["status"] = "ready"
            
            updated_desc_str = json.dumps(desc_json)
            
            # 4. Save to DB
            db.table("batches").update({
                "description": updated_desc_str,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", batch_id).execute()
            
            # 5. Insert notification
            try:
                db.table("notifications").insert({
                    "type": "SETTING_CHANGE",
                    "message": f"AI Teaching Agent '{desc_json['agent'].get('agentName', 'AI Assistant')}' is ready for batch '{batch_name}'!",
                    "is_read": False,
                    "created_at": datetime.utcnow().isoformat()
                }).execute()
            except Exception as e:
                print(f"[Warn] Notification error in background task: {e}")
                
    except Exception as e:
        print(f"[Error] Background slides generation failed for batch {batch_id}: {e}")
        # Mark as failed in DB
        try:
            from app.core.database import get_db
            db = get_db()
            batch_result = db.table("batches").select("*").eq("id", batch_id).execute()
            if batch_result.data:
                batch_row = batch_result.data[0]
                desc_str = batch_row.get("description")
                if desc_str:
                    desc_json = json.loads(desc_str)
                    if "agent" in desc_json:
                        desc_json["agent"]["status"] = "failed"
                        db.table("batches").update({
                            "description": json.dumps(desc_json),
                            "updated_at": datetime.utcnow().isoformat()
                        }).eq("id", batch_id).execute()
        except Exception as db_err:
            print(f"[Error] Failed to mark status as failed: {db_err}")

# ============ Routes ============
@router.post("/create/{batch_id}", response_model=BatchResponse)
async def create_agent(
    batch_id: str,
    req: AgentCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(has_role("ADMIN", "COORDINATOR", "TRAINER"))
):
    """Create or update the AI Teaching Agent for a batch"""
    from app.core.config import settings
    db = get_db()
    
    # 1. Fetch batch
    batch_result = db.table("batches").select("*").eq("id", batch_id).execute()
    if not batch_result.data:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch_row = batch_result.data[0]
    
    # 2. Resolve user's actual full name from database
    user_name = "Trainer"
    user_res = db.table("users").select("full_name").eq("id", current_user.get("sub")).execute()
    if user_res.data:
        user_name = user_res.data[0].get("full_name", "")

    # Check permissions if current user is trainer
    if current_user.get("role") == "TRAINER":
        trainers_list = batch_row.get("trainers", []) or []
        trainers_lower = [t.lower() for t in trainers_list]
        if not user_name or user_name.lower() not in trainers_lower:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only manage agents for cohorts assigned to you."
            )

    # 3. Check Azure AI Services API key
    if not settings.AZURE_OPENAI_API_KEY or settings.AZURE_OPENAI_API_KEY.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Azure AI Services API Key is not configured. Please add AZURE_OPENAI_API_KEY to your .env file."
        )

    # 4. Parse curriculum — use selectedDays from timeline if provided
    selected_days = req.selectedDays or []
    parsed_topics = []
    
    if selected_days:
        # Extract topics from the targets timeline for the selected days only
        desc_str_raw = batch_row.get("description", "")
        desc_json_raw = {}
        if desc_str_raw:
            try:
                desc_json_raw = json.loads(desc_str_raw)
            except Exception:
                desc_json_raw = {}
        
        targets = desc_json_raw.get("targets", [])
        if not targets:
            raise HTTPException(
                status_code=400,
                detail="This batch has no targets timeline generated. Please generate the timeline first before appointing an AI agent with selected days."
            )
        
        parsed_topics = extract_topics_from_timeline(targets, selected_days)
        if not parsed_topics:
            raise HTTPException(
                status_code=400,
                detail="No topics found for the selected days. Please check the timeline schedule."
            )
    else:
        # Fallback: use all topics (legacy behavior)
        topics_list = batch_row.get("topics") or []
        if not topics_list:
            desc_str = batch_row.get("description")
            if desc_str:
                try:
                    parsed = json.loads(desc_str)
                    topics_list = parsed.get("topics", [])
                except Exception:
                    pass
                    
        if not topics_list:
            raise HTTPException(
                status_code=400,
                detail="Batch curriculum is empty. Please add topics to the batch before creating an agent."
            )

        parsed_topics = parse_batch_topics(topics_list)

    # 5. Embed Agent data in batch description JSON with 'preparing' status
    desc_str = batch_row.get("description")
    desc_json = {}
    if desc_str:
        try:
            desc_json = json.loads(desc_str)
        except Exception:
            desc_json = {"text": desc_str}
            
    # Structure Agent config and set status to preparing
    agent_data = {
        "agentName": req.agentName,
        "modelName": req.modelName,
        "temperature": req.temperature,
        "promptInstruction": req.promptInstruction,
        "additionalInstruction": req.additionalInstruction,
        "createdBy": user_name or "Trainer",
        "createdAt": datetime.utcnow().isoformat(),
        "status": "preparing",
        "content": [],
        "selectedDays": selected_days if selected_days else None
    }
    
    desc_json["agent"] = agent_data
    updated_desc_str = json.dumps(desc_json)
    
    # 6. Update batch record in Supabase
    update_result = db.table("batches").update({
        "description": updated_desc_str,
        "updated_at": datetime.utcnow().isoformat()
    }).eq("id", batch_id).execute()
    
    if not update_result.data:
        raise HTTPException(status_code=500, detail="Failed to save agent to database")
        
    # Queue background task to run Langgraph content generation
    initial_state = {
        "batch_name": batch_row.get("batch_name", "Untitled Batch"),
        "topics": parsed_topics,
        "model_name": req.modelName,
        "temperature": req.temperature,
        "prompt_instruction": req.promptInstruction,
        "additional_instruction": req.additionalInstruction,
        "generated_content": []
    }
    background_tasks.add_task(
        bg_generate_slides, 
        batch_id=batch_id, 
        initial_state=initial_state, 
        batch_name=batch_row.get("batch_name", "Untitled Batch")
    )
    
    # Log AGENT_CREATED notification
    try:
        user_role_label = "Trainer" if current_user.get("role") == "TRAINER" else current_user.get("role", "User").title()
        db.table("notifications").insert({
            "type": "SETTING_CHANGE",
            "message": f"AI Teaching Agent '{req.agentName}' appointed for batch '{batch_row.get('batch_name')}' by {user_role_label} {user_name}.",
            "is_read": False,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
    except Exception as notif_err:
        print(f"[Warn] Failed to create AGENT_CREATED notification: {notif_err}")
        
    return BatchResponse(**row_to_api(update_result.data[0]))

@router.delete("/{batch_id}", response_model=BatchResponse)
async def delete_agent(
    batch_id: str,
    current_user: dict = Depends(has_role("ADMIN", "COORDINATOR", "TRAINER"))
):
    """Remove AI Teaching Agent from a batch"""
    db = get_db()
    
    # 1. Fetch batch
    batch_result = db.table("batches").select("*").eq("id", batch_id).execute()
    if not batch_result.data:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch_row = batch_result.data[0]
    
    # 2. Resolve user's actual full name from database
    user_name = "Trainer"
    user_res = db.table("users").select("full_name").eq("id", current_user.get("sub")).execute()
    if user_res.data:
        user_name = user_res.data[0].get("full_name", "")

    # Check permissions if current user is trainer
    if current_user.get("role") == "TRAINER":
        trainers_list = batch_row.get("trainers", []) or []
        trainers_lower = [t.lower() for t in trainers_list]
        if not user_name or user_name.lower() not in trainers_lower:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only manage agents for cohorts assigned to you."
            )

    # 3. Modify description JSON
    desc_str = batch_row.get("description")
    desc_json = {}
    if desc_str:
        try:
            desc_json = json.loads(desc_str)
        except Exception:
            desc_json = {"text": desc_str}
            
    if "agent" in desc_json:
        del desc_json["agent"]
        
    updated_desc_str = json.dumps(desc_json)
    
    # 4. Update batch record in Supabase
    update_result = db.table("batches").update({
        "description": updated_desc_str,
        "updated_at": datetime.utcnow().isoformat()
    }).eq("id", batch_id).execute()
    
    if not update_result.data:
        raise HTTPException(status_code=500, detail="Failed to delete agent from database")
        
    return BatchResponse(**row_to_api(update_result.data[0]))
