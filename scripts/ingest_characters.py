import os
import fitz
from pathlib import Path

# Load .env.local manually (no dotenv dependency needed)
env_path = Path(__file__).parent.parent / '.env.local'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, value = line.partition('=')
                os.environ.setdefault(key.strip(), value.strip())


import ollama
from json_repair import repair_json
import json
from pathlib import Path
from sentence_transformers import SentenceTransformer
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL       = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPABASE_KEY       = os.environ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
SHEETS_DIR         = Path(__file__).parent / 'character_sheets'
SYSTEM_USER_ID     = os.environ['SYSTEM_USER_ID']

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Local Embedding Model
embed_model = SentenceTransformer('BAAI/bge-base-en-v1.5')

def pdf_to_image_bytes(pdf_path):
    doc = fitz.open(pdf_path)
    page = doc.load_page(0) 
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4))
    return pix.tobytes("png")

import re # Import this at the top

def extract_character_data(image_bytes):
    prompt = """
    You are an expert at parsing D&D 5e character sheets.
    Your task: Extract every field into a strict JSON object.
    
    INSTRUCTIONS:
    1. If a value is unreadable, output null. DO NOT GUESS defaults (like 10 or 0).
    2. Look at the top for name, race, and background.
    3. Look at the central bubbles for stats (str, dex, con, int, wis, cha).
    4. Look for the 'Personality', 'Ideals', 'Bonds', 'Flaws' boxes on the left.
    5. Ensure JSON output is standard.
    
    CRITICAL: 
    - Do NOT perform any math. If the box says '1d10', return '1d10'. 
    - If a field is empty, return null. 
    - If reading a number, check the small digit in the corner of the bubble, not the big stat.
    - For Personality, Ideals, Bonds, and Flaws, extract the exact text found in those boxes.

    Output strictly in this JSON format:
    {
        "name": "string", "race": "string", "class": "string", "level": int, 
        "background": "string", "alignment": "string",
        "str": int, "dex": int, "con": int, "int": int, "wis": int, "cha": int,
        "ac": int, "max_hp": int, "speed": int, "hit_dice": "string",
        "personality_traits": "string", "ideals": "string", "bonds": "string", "flaws": "string",
        "proficiencies": {"saving_throws": [], "skills": [], "tools": [], "languages": [], "passive_perception": int},
        "features_and_traits": [{"name": "string", "description": "string"}],
        "actions": [{"name": "string", "type": "string", "hit_bonus": "string", "damage": "string"}],
        "equipment": ["string"]
    }
    """
    
    response = ollama.generate(
        model='llama3.2-vision', 
        prompt=prompt,
        images=[image_bytes],
        stream=False,
        options={'temperature': 0, 'num_predict': 2048}
    )
    
    raw_text = response['response']
    
    # --- AUTOMATIC JSON REPAIR ---
    # This will automatically fix missing quotes, 
    # bad trailing commas, and unquoted keys.
    repaired_json = repair_json(raw_text)
    
    try:
        return json.loads(repaired_json)
    except json.JSONDecodeError:
        print(f"❌ Could not repair JSON output. Raw output was: {raw_text}")
        return None

def process_single_file(file_path):
    """Encapsulates the logic for one character sheet with error handling."""

    if not SYSTEM_USER_ID:
        print("❌ Error: SYSTEM_USER_ID not found in environment variables.")
        return
    
    try:
        print(f"Processing: {file_path.name}...")
        img_bytes = pdf_to_image_bytes(str(file_path))
        data = extract_character_data(img_bytes)
        data["user_id"] = SYSTEM_USER_ID

        print(f"DEBUG: Model returned type {type(data)}")
        
        # --- DEFENSIVE CHECK ---
        if isinstance(data, list):
            print("⚠️ Model returned a list, unwrapping to the first item...")
            if len(data) > 0:
                data = data[0]
            else:
                print("❌ Error: List was empty.")
                return

        if not isinstance(data, dict):
            print(f"❌ Error: Expected dict, got {type(data)}. Content: {data}")
            return
        
        # Use .get() with safer defaults to prevent missing-key errors
        # This handles cases where some fields might be missing from the OCR
        data["is_npc"] = data.get("is_npc", False)
        data["proficiency_bonus"] = data.get("proficiency_bonus", 2)
        
        # Safely access nested dictionary
        profs = data.get("proficiencies", {})
        data["passive_wisdom"] = profs.get("passive_perception", 10)
        
        data["source_pdf"] = file_path.name
        
        # RAG Embedding
        context_text = f"{data.get('name', 'Unknown')} the {data.get('race', '')} {data.get('class', '')}."
        data["context_text"] = context_text
        data["context_embedding"] = embed_model.encode(context_text).tolist()
        
        # Upload
        supabase.table("characters").insert(data).execute()
        print(f"✅ Successfully ingested: {file_path.name}")
        
    except Exception as e:
        print(f"❌ Failed to process {file_path.name}: {e}")

def main():
    # Convert string path to a Path object
    data_folder = SHEETS_DIR
    
    # Check if directory exists
    if not data_folder.exists():
        print(f"Directory {SHEETS_DIR} not found. Please create it and add your PDFs.")
        return

    # Find all .pdf files (case-insensitive)
    pdf_files = list(data_folder.glob("*.pdf"))
    
    if not pdf_files:
        print("No PDF files found in the directory.")
        return

    print(f"Found {len(pdf_files)} character sheets. Starting batch processing...")

    for pdf_file in pdf_files:
        process_single_file(pdf_file)

    print("--- Batch Ingestion Complete ---")

if __name__ == "__main__":
    main()