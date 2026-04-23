import os
import sys
import time
import re
import uuid
from pathlib import Path
from typing import Optional

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
from supabase import create_client
import pypdf

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL       = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPABASE_KEY       = os.environ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
CHARACTER_SHEETS_DIR = Path(__file__).parent / 'character_sheets'
CHUNK_SIZE         = 1500   # characters
CHUNK_OVERLAP      = 150    # characters overlap between chunks
EMBED_MODEL        = 'nomic-embed-text'  # local via Ollama, 768 dimensions
SYSTEM_USER_ID     = os.environ['SYSTEM_USER_ID']   # Default system user ID for pregenerated character ownership

# ── Clients ────────────────────────────────────────────────────────────────
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Types ───────────────────────────────────────────────────────────────────
class CharacterData:
    def __init__(
        self,
        name: Optional[str] = None,
        race: Optional[str] = None,
        class_type: Optional[str] = None,
        background: Optional[str] = None,
        max_hp: Optional[int] = None,
        ac: Optional[int] = None,
        str: Optional[int] = None,
        dex: Optional[int] = None,
        con: Optional[int] = None,
        int: Optional[int] = None,
        wis: Optional[int] = None,
        cha: Optional[int] = None,
        level: Optional[int] = None,
        notes: Optional[str] = None,
        source_pdf: Optional[str] = None,
    ):
        self.name = name
        self.race = race
        self.class_type = class_type
        self.background = background
        self.max_hp = max_hp
        self.ac = ac
        self.str = str
        self.dex = dex
        self.con = con
        self.int = int
        self.wis = wis
        self.cha = cha
        self.level = level
        self.notes = notes
        self.source_pdf = source_pdf


# ── Helpers ────────────────────────────────────────────────────────────────
def extract_text_from_pdf(pdf_path: Path) -> list[tuple[int, str]]:
    """Returns list of (page_number, page_text) tuples."""
    pages = []
    reader = pypdf.PdfReader(str(pdf_path))
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if text.strip():
            pages.append((i + 1, text))
    return pages


def chunk_text(page_num: int, text: str) -> list[dict]:
    """Split page text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end]
        if chunk.strip():
            chunks.append({
                'page': page_num,
                'content': chunk.strip()
            })
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def get_embedding(text: str) -> list[float]:
    """Get embedding for text using Ollama."""
    try:
        result = ollama.embed(model=EMBED_MODEL, input=text)
        return result.embeddings[0]
    except Exception as e:
        print(f'  ⚠️  Embedding error: {e}')
        return []


def extract_character_info(text: str) -> Optional[CharacterData]:
    """Extract character data from parsed PDF text using regex patterns."""
    character = CharacterData()
    
    # Split text into lines and clean them
    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        # Remove quotation marks and trim
        line = line.replace('"', '').replace("'", '').strip()
        if line:
            cleaned_lines.append(line)
    
    # Get specific lines based on your PDF structure
    if len(cleaned_lines) >= 1:
        character.race = cleaned_lines[0]
    
    if len(cleaned_lines) >= 2:
        character.class_type = cleaned_lines[1]
        # Extract level from line 2 (look for a number)
        level_match = re.search(r'(\d+)', cleaned_lines[1])
        if level_match:
            character.level = int(level_match.group(1))
    
    # Use race + class + level as name placeholder
    if not character.name:
        character.name = f"{character.race or ''}_{character.class_type or ''}_{character.level or '1'}"
    
    # Quote (lines 3-5)
    if len(cleaned_lines) >= 3:
        quote_text = cleaned_lines[2] + ' ' + cleaned_lines[3] + ' ' + cleaned_lines[4]
        # Extract text inside quotation marks if present
        if quote_text.startswith('"') or quote_text.startswith("'"):
            quote_match = re.search(r'"([^"]+)"|\'([^\']+)\'', quote_text)
            if quote_match:
                character.notes = quote_match.group(1) or quote_match.group(2)
        else:
            character.notes = quote_text
    
    # Text/Description (lines 6-12)
    if len(cleaned_lines) >= 6:
        text_lines = cleaned_lines[5:12]  # Lines 6-12 (indices 5-11)
        character.notes = character.notes + ' ' + ' '.join(text_lines) if character.notes else ' '.join(text_lines)
    
    # Background (line 13)
    if len(cleaned_lines) >= 13:
        character.background = cleaned_lines[12]
    
    # HP (hit points) - look for "HP:" or "Hit Points:" in the text
    hp_match = re.search(r'hp?\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if hp_match:
        character.max_hp = int(hp_match.group(1))
    
    # AC (armor class) - look for "AC:" or "Armor Class:" in the text
    ac_match = re.search(r'ac\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if ac_match:
        character.ac = int(ac_match.group(1))
    
    # Ability Scores - look for STR, DEX, CON, INT, WIS, CHA (capitalized) in the text
    # Pattern: STR (number) (+modifier)
    str_match = re.search(r'str\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if str_match:
        character.str = int(str_match.group(1))
    
    dex_match = re.search(r'dex\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if dex_match:
        character.dex = int(dex_match.group(1))
    
    con_match = re.search(r'con\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if con_match:
        character.con = int(con_match.group(1))
    
    int_match = re.search(r'int\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if int_match:
        character.int = int(int_match.group(1))
    
    wis_match = re.search(r'wis\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if wis_match:
        character.wis = int(wis_match.group(1))
    
    cha_match = re.search(r'cha\s*[:—-]?\s*(\d+)', text, re.IGNORECASE)
    if cha_match:
        character.cha = int(cha_match.group(1))
    
    # Only return if we have meaningful data
    if not character.race and not character.class_type:
        print(f'  ⚠️  No character data found in PDF. Skipping.')
        return None
    
    return character


def document_already_ingested(title: str) -> bool:
    """Check if a document has already been ingested."""
    try:
        result = supabase.table('documents').select('id').eq('title', title).execute()
        return len(result.data) > 0
    except Exception as e:
        print(f'  ⚠️  Error checking document status: {e}')
        return False


def character_already_exists(name: str) -> bool:
    """Check if a character with this name already exists."""
    try:
        result = supabase.table('characters').select('id').eq('name', name).execute()
        return len(result.data) > 0
    except Exception as e:
        print(f'  ⚠️  Error checking character status: {e}')
        return False


# ── Main ───────────────────────────────────────────────────────────────────
def ingest_character_sheets():
    pdf_files = sorted(CHARACTER_SHEETS_DIR.glob('*.pdf'))

    if not pdf_files:
        print(f'No PDFs found in {CHARACTER_SHEETS_DIR}')
        print(f'Please add premade character sheets to {CHARACTER_SHEETS_DIR}')
        sys.exit(0)  # Exit gracefully, not an error

    print(f'Found {len(pdf_files)} character sheet PDF(s) to process\n')

    for pdf_path in pdf_files:
        title = pdf_path.name
        print(f'{"="*60}')
        print(f'Processing: {title}')
        print(f'{"="*60}')

        # Extract text page by page
        pages = extract_text_from_pdf(pdf_path)
        if not pages:
            print(f'  ⚠️  No text found in PDF, skipping.\n')
            continue
        
        print(f'  📄 Extracted {len(pages)} pages with text')

        # Try to extract character info from the entire PDF (or first page with character data)
        character = None
        for page_num, page_text in pages:
            if character:
                break  # Already found character data
            
            character = extract_character_info(page_text)
            if character and (character.name or character.class_type):
                break
        
        if not character:
            print(f'  ⚠️  No valid character data found in {title}\n')
            continue

        # Check if character already exists
        if character_already_exists(character.name or ''):
            print(f'  ⚠️  Character "{character.name}" already exists, skipping.\n')
            continue

        # Embed the character context for RAG
        character_context_text = f"{character.name or ''} {character.race or ''} {character.class_type or ''} {character.background or ''}"
        if character.max_hp:
            character_context_text += f" Max HP {character.max_hp}"
        if character.ac:
            character_context_text += f" AC {character.ac}"
        character_context_embedding = get_embedding(character_context_text)
        
        # Insert character into characters table
        try:
            character_result = supabase.table('characters').insert({
                'user_id': SYSTEM_USER_ID,  # Use system user ID
                'name': character.name,
                'race': character.race,
                'class': character.class_type,
                'background': character.background,
                'max_hp': character.max_hp,
                'ac': character.ac,
                'str': character.str,
                'dex': character.dex,
                'con': character.con,
                'int': character.int,
                'wis': character.wis,
                'cha': character.cha,
                'level': character.level,
                'notes': character.notes,
                'source_pdf': character.source_pdf,
                'context_embedding': character_context_embedding if character_context_embedding else [],
                'context_text': character_context_text
            }).execute()
            
            character_id = character_result.data[0]['id'] if character_result.data else None
            
            # Create document record for the character sheet
            doc_result = supabase.table('documents').insert({
                'title': title,
                'type': 'character_sheet'
            }).execute()
            
            print(f'  ✅ Character "{character.name}" ingested successfully (id: {character_id})')
            print(f'     Class: {character.class_type}')
            if character.max_hp:
                print(f'     Max HP: {character.max_hp}')
            if character.ac:
                print(f'     AC: {character.ac}')
            print(f'     Stats: STR {character.str}, DEX {character.dex}, CON {character.con}, INT {character.int}, WIS {character.wis}, CHA {character.cha}\n')
            
        except Exception as e:
            print(f'\n  ❌ Error inserting character {character.name}: {e}')
            continue

    print('🎲 Character sheet ingestion complete!')


if __name__ == '__main__':
    ingest_character_sheets()