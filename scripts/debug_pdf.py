import os
import sys
from pathlib import Path

# Load .env.local manually
env_path = Path(__file__).parent.parent / '.env.local'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, value = line.partition('=')
                os.environ.setdefault(key.strip(), value.strip())

import pypdf
import re

CHARACTER_SHEETS_DIR = Path(__file__).parent / 'character_sheets'

def extract_text_from_pdf(pdf_path: Path) -> list[tuple[int, str]]:
    """Returns list of (page_number, page_text) tuples."""
    pages = []
    reader = pypdf.PdfReader(str(pdf_path))
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if text.strip():
            pages.append((i + 1, text))
    return pages

def debug_extract(pdf_path: Path):
    print(f'{"="*60}')
    print(f'Debugging: {pdf_path.name}')
    print(f'{"="*60}')
    
    pages = extract_text_from_pdf(pdf_path)
    
    if not pages:
        print(f'❌ No text extracted from PDF')
        return
    
    print(f'✅ Extracted {len(pages)} page(s)')
    print(f'\n--- Page 1 Text (first 3000 chars) ---')
    text = pages[0][1]
    print(text[:3000])
    
    # Show all unique lines
    print(f'\n--- All Unique Lines (first 50) ---')
    unique_lines = []
    seen = set()
    for line in text.split('\n'):
        cleaned = line.strip().replace('"', '').replace("'", '')
        if cleaned and cleaned not in seen:
            unique_lines.append(cleaned)
            seen.add(cleaned)
            if len(unique_lines) >= 50:
                break
    for line in unique_lines:
        print(f'  {line}')
    
    # Test ability scores with more flexible patterns
    print(f'\n--- Testing Ability Score Patterns ---')
    text_lower = text.lower()
    
    # Try different patterns for each stat
    stat_patterns = {
        'str': [
            r'str\s*[:—-]?\s*(\d+)',
            r'strength\s*[:—-]?\s*(\d+)',
            r'str\s*[:—-]?\s*([ivx]+)',  # Roman numerals
        ],
        'dex': [
            r'dex\s*[:—-]?\s*(\d+)',
            r'dexterity\s*[:—-]?\s*(\d+)',
        ],
        'con': [
            r'con\s*[:—-]?\s*(\d+)',
            r'constitution\s*[:—-]?\s*(\d+)',
        ],
        'int': [
            r'int\s*[:—-]?\s*(\d+)',
            r'intelligence\s*[:—-]?\s*(\d+)',
        ],
        'wis': [
            r'wis\s*[:—-]?\s*(\d+)',
            r'wisdom\s*[:—-]?\s*(\d+)',
        ],
        'cha': [
            r'cha\s*[:—-]?\s*(\d+)',
            r'charisma\s*[:—-]?\s*(\d+)',
        ],
    }
    
    for stat in ['str', 'dex', 'con', 'int', 'wis', 'cha']:
        found = False
        for pattern in stat_patterns[stat]:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                print(f'✅ Found {stat.upper()}: {match.group(1)}')
                found = True
                break
        if not found:
            print(f'❌ No {stat.upper()} found')
            # Check if stat is in text at all
            if any(keyword in text_lower for keyword in [f'{stat}:' , f'{stat} ', f'{stat}']):
                print(f'  But "{stat}" is in the text')
                # Show context around the stat
                idx = text_lower.find(stat)
                if idx != -1:
                    context_start = max(0, idx - 50)
                    context_end = min(len(text), idx + 50)
                    context = text[context_start:context_end]
                    print(f'  Context: "{context}"')
    
    # Test for ability scores in any format
    print(f'\n--- Looking for Ability Score Keywords ---')
    keywords = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
    for keyword in keywords:
        if keyword in text_lower:
            idx = text_lower.find(keyword)
            # Show 50 chars before and after
            context_start = max(0, idx - 30)
            context_end = min(len(text), idx + 30)
            context = text[context_start:context_end]
            print(f'✅ Found "{keyword}"')
            print(f'  Context: "{context}"')
            break
    
    # Show first 20 lines with line numbers
    print(f'\n--- First 20 Lines with Line Numbers ---')
    lines = text.split('\n')[:20]
    for i, line in enumerate(lines, 1):
        print(f'{i:3}: {line}')

if __name__ == '__main__':
    pdf_files = sorted(CHARACTER_SHEETS_DIR.glob('*.pdf'))
    
    if not pdf_files:
        print(f'No PDFs found in {CHARACTER_SHEETS_DIR}')
        sys.exit(0)
    
    for pdf_path in pdf_files:
        debug_extract(pdf_path)
        print()