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
    print(f'\n--- Page 1 Text ---')
    print(pages[0][1])
    print(f'\n--- Page 1 Text (first 2000 chars) ---')
    print(pages[0][1][:2000])
    
    # Try some basic regex patterns
    text = pages[0][1]
    
    print(f'\n--- Testing Regex Patterns ---')
    
    # Test name
    name_match = __import__('re').search(r'name\s*[:—-]\s*([^.\n\r]+)', text, __import__('re').IGNORECASE)
    if name_match:
        print(f'✅ Found name: {name_match.group(1).strip()}')
    else:
        print('❌ No name found')
        # Try alternative patterns
        print('  Trying alternative patterns...')
        if 'Name:' in text or 'Name :' in text or 'Name :' in text:
            print('  Found "Name:" in text')
        if 'name:' in text.lower():
            print('  Found "name:" in text (lowercase)')
    
    # Test class
    class_match = __import__('re').search(r'class\s*[:—-]\s*([^.\n\r]+)', text, __import__('re').IGNORECASE)
    if class_match:
        print(f'✅ Found class: {class_match.group(1).strip()}')
    else:
        print('❌ No class found')
        if 'Class:' in text or 'Class :' in text:
            print('  Found "Class:" in text')
    
    # Test HP
    hp_match = __import__('re').search(r'hp?\s*[:—-]?\s*(\d+)', text, __import__('re').IGNORECASE)
    if hp_match:
        print(f'✅ Found HP: {hp_match.group(1)}')
    else:
        print('❌ No HP found')
        # Look for HP in text
        if 'HP' in text or 'hp' in text:
            print('  Found "HP" or "hp" in text')
            # Show context
            idx = text.lower().find('hp')
            if idx != -1:
                print(f'  Context: "{text[max(0,idx-30):idx+30]}"')
    
    # Test ability scores
    stats = ['str', 'dex', 'con', 'int', 'wis', 'cha']
    for stat in stats:
        pattern = rf'{stat}\s*[:—-]?\s*(\d+)'
        match = __import__('re').search(pattern, text, __import__('re').IGNORECASE)
        if match:
            print(f'✅ Found {stat.upper()}: {match.group(1)}')
        else:
            print(f'❌ No {stat.upper()} found')
            # Check if stat is in text at all
            if stat.upper() in text:
                print(f'  But "{stat.upper()}" is in the text')
    
    print(f'\n--- Looking for common character sheet patterns ---')
    
    # Look for common patterns
    patterns = [
        (r'Name\s*[:—-]', 'Name label'),
        (r'Race\s*[:—-]', 'Race label'),
        (r'Class\s*[:—-]', 'Class label'),
        (r'Background\s*[:—-]', 'Background label'),
        (r'HP\s*[:—-]', 'HP label'),
        (r'AC\s*[:—-]', 'AC label'),
        (r'Strength\s*[:—-]', 'Strength label'),
        (r'Dexterity\s*[:—-]', 'Dexterity label'),
        (r'Constitution\s*[:—-]', 'Constitution label'),
        (r'Intelligence\s*[:—-]', 'Intelligence label'),
        (r'Wisdom\s*[:—-]', 'Wisdom label'),
        (r'Charisma\s*[:—-]', 'Charisma label'),
    ]
    
    for pattern, desc in patterns:
        if __import__('re').search(pattern, text, __import__('re').IGNORECASE):
            print(f'✅ Found pattern: {desc}')
        else:
            print(f'❌ No pattern: {desc}')
    
    # Show first few lines
    print(f'\n--- First 10 lines of text ---')
    lines = text.split('\n')[:10]
    for i, line in enumerate(lines, 1):
        print(f'{i}: {line}')

if __name__ == '__main__':
    pdf_files = sorted(CHARACTER_SHEETS_DIR.glob('*.pdf'))
    
    if not pdf_files:
        print(f'No PDFs found in {CHARACTER_SHEETS_DIR}')
        sys.exit(0)
    
    for pdf_path in pdf_files:
        debug_extract(pdf_path)
        print()
