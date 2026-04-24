import os
import fitz
from pathlib import Path
import re

# Load .env.local manually (no dotenv dependency needed)
env_path = Path(__file__).parent.parent / ".env.local"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())


import ollama
from json_repair import repair_json
import json
from pathlib import Path
from sentence_transformers import SentenceTransformer
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
SHEETS_DIR = Path(__file__).parent / "character_sheets"
SYSTEM_USER_ID = os.environ["SYSTEM_USER_ID"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Local Embedding Model
embed_model = SentenceTransformer("BAAI/bge-base-en-v1.5")


def pdf_to_image_bytes(pdf_path):
    doc = fitz.open(pdf_path)
    page = doc.load_page(0)
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4))
    return pix.tobytes("png")


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

    SYSTEM: You are a JSON parsing machine. Do NOT act as a chatbot. Do NOT greet. Do NOT summarize.
    TASK: Extract character data into JSON.
    OUTPUT RULES:
    1. Output ONLY a valid JSON object.
    2. No markdown formatting (no ```json ... ``` tags).
    3. No preamble. No concluding text.
    4. If a value is unknown, use null.
    5. 'hit_dice': Only extract the class-specific Hit Die (e.g., "1d8", "1d6"). Do NOT include damage values, attack bonuses, or flavor text.
    6. 'notes': If you find "Faction" information or extra story text, put it here. Do NOT include it in personality_traits or background.
    7. 'race': Extract ONLY the race name (e.g., "Human", "Hill Dwarf"). 
       - DO NOT include size (e.g., "Medium humanoid").
       - DO NOT include alignment in this field.
    8. 'background': Look specifically for the "Background" box. 
       - DO NOT use the "Faction" name as the background.
    9. 'alignment': Extract only the two-word alignment (e.g., "Chaotic Good").
    10. If the data looks like a sentence (e.g., "A human fighter from..."), discard it and return only the keyword.
    11. If a field is not found, return null.

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
        model="llama3.2-vision",
        prompt=prompt,
        images=[image_bytes],
        stream=False,
        options={"temperature": 0, "num_predict": 512, "stop": ["\n\n\n"]},
    )

    raw_text = response["response"]

    # --- AUTOMATIC JSON REPAIR ---
    # This will automatically fix missing quotes,
    # bad trailing commas, and unquoted keys.
    repaired_json = repair_json(raw_text)

    try:
        return json.loads(repaired_json)
    except json.JSONDecodeError:
        print(f"❌ Could not repair JSON output. Raw output was: {raw_text}")
        return None


def sanitize_character_data(data):
    """
    Ensures all NOT NULL fields exist and injects them
    into all expected JSON keys to prevent mapping overwrites.
    """

    # 1. Catch missing core stats (Level, AC, HP, Speed)
    data["level"] = data.get("level") or 1
    if data.get("ac") is None:
        data["ac"] = 10
    if data.get("max_hp") is None:
        data["max_hp"] = 10
    if data.get("speed") is None:
        data["speed"] = 30

    # 2. Clean up the 'race' field
    if data.get("race"):
        race_str = str(data["race"])
        # Remove "Medium humanoid", "(", ")", and trailing alignment garbage
        race_str = re.sub(
            r"(Medium|Small|Large)\s+humanoid\s*", "", race_str, flags=re.IGNORECASE
        )
        race_str = race_str.replace("(", "").replace(")", "").split(",")[0].strip()
        data["race"] = race_str.title()  # Capitalize nicely

    # 3. Clean up the 'background' field
    if data.get("background"):
        bg_str = str(data["background"])
        # If the AI grabbed the Faction label, try to strip it
        if "Faction:" in bg_str or "Alliance" in bg_str:
            # Often the background is listed right before or after.
            # If we can't find it, we'll default to a clean string or null.
            data["background"] = bg_str.replace("Faction:", "").strip()

    # 4. Consistency check for Human/Dwarf Race
    # Sometimes the model returns "human" or "hill dwarf"
    # Let's ensure it's just the core race name
    if "human" in data.get("race", "").lower():
        data["race"] = "Human"
    if "dwarf" in data.get("race", "").lower():
        data["race"] = "Dwarf"

    # 5. Calculate Passive Wisdom safely
    wis_score = int(data.get("wis") or 10)
    wis_mod = (wis_score - 10) // 2
    calculated_passive = 10 + wis_mod

    # 6. Force it at the top level
    data["passive_wisdom"] = calculated_passive

    # 7. Force it inside the proficiencies object
    # (This prevents your script from overwriting it later)
    if "proficiencies" not in data or not isinstance(data["proficiencies"], dict):
        data["proficiencies"] = {}

    data["proficiencies"]["passive_perception"] = calculated_passive
    data["proficiencies"]["passive_wisdom"] = calculated_passive

    # Force truncation for text fields to prevent "infinite loop" garbage
    text_fields = ["personality_traits", "ideals", "bonds", "flaws"]
    for field in text_fields:
        if field in data and data[field]:
            # Keep it reasonable (e.g., max 255 characters)
            if len(str(data[field])) > 255:
                data[field] = str(data[field])[:252] + "..."

    return data


def process_single_file(file_path):
    """Encapsulates the logic for one character sheet with error handling."""

    if not SYSTEM_USER_ID:
        print("❌ Error: SYSTEM_USER_ID not found in environment variables.")
        return

    try:
        # 1. Deduplication Check
        # Look for the file in the documents table
        existing_doc = (
            supabase.table("documents")
            .select("id")
            .eq("title", file_path.name)
            .execute()
        )

        if existing_doc.data:
            document_id = existing_doc.data[0]["id"]
            print(f"⏭️ Skipping: {file_path.name} already exists (ID: {document_id})")
            return  # Skip the rest of the processing

        # 2. Extract the data
        print(f"Processing: {file_path.name}...")
        img_bytes = pdf_to_image_bytes(str(file_path))
        data = extract_character_data(img_bytes)

        # STOP HERE if the LLM returned nothing
        if data is None:
            print(f"❌ Extraction returned None. Skipping {file_path.name}.")
            return

        # Catch that specific typo just in case it put the real HP value in there
        if "max_hap" in data:
            data["max_hp"] = data.pop("max_hap")

        # Enforce strict format for hit_dice
        if data.get("hit_dice"):
            match = re.search(r"\d+d\d+", str(data["hit_dice"]))
            data["hit_dice"] = match.group(0) if match else "1d8"

        # Prevent Faction/Looping text from contaminating other fields
        # If the LLM put long text in personality_traits, cut it off and move it to notes
        if len(str(data.get("personality_traits", ""))) > 100:
            data["notes"] = data["personality_traits"]
            data["personality_traits"] = "See notes for details."

        # 3. Sanitize and prepare data
        data = sanitize_character_data(data)
        data["user_id"] = SYSTEM_USER_ID

        # 4. Insert into 'documents'
        doc_entry = {
            "title": file_path.name,
            "type": "character_sheet",
        }

        doc_response = supabase.table("documents").insert(doc_entry).execute()
        # Grab the ID of the document we just created
        document_id = doc_response.data[0]["id"]
        print(f"📄 Created document record for {file_path.name} (ID: {document_id})")

        # 5. Link character to the document
        data["document_id"] = document_id

        allowed_columns = [
            "id",
            "user_id",
            "name",
            "race",
            "class",
            "level",
            "background",
            "alignment",
            "str",
            "dex",
            "con",
            "int",
            "wis",
            "cha",
            "ac",
            "max_hp",
            "speed",
            "hit_dice",
            "personality_traits",
            "ideals",
            "bonds",
            "flaws",
            "proficiencies",
            "features_and_traits",
            "actions",
            "equipment",
            "document_id",
            "passive_wisdom",
            "notes",
        ]

        # Create a new dictionary keeping ONLY the keys that match your database
        clean_data = {k: v for k, v in data.items() if k in allowed_columns}

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

        # 6. Insert the CLEAN data into 'characters'
        supabase.table("characters").insert(clean_data).execute()
        print(f"✅ Successfully ingested {file_path.name} into characters table.")

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
