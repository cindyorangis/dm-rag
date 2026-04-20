import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { supabaseAdmin } from '../lib/supabase'; // Using the admin client
import { embeddingModel } from '../lib/gemini';

// Simple chunking utility: Splits text by character count, 
// attempting to keep words intact
function splitIntoChunks(text: string, chunkSize: number = 2000): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  const words = text.split(' ');

  for (const word of words) {
    if ((currentChunk.length + word.length) > chunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += word + ' ';
  }
  chunks.push(currentChunk.trim());
  return chunks;
}

async function ingestBooks() {
  const booksDir = path.join(__dirname, 'books');
  const files = fs.readdirSync(booksDir).filter(file => file.endsWith('.pdf'));

  for (const file of files) {
    console.log(`--- Processing: ${file} ---`);
    
    // 1. Create Document Record
    const { data: doc, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({ title: file, type: 'rulebook' })
      .select()
      .single();

    if (docError) throw docError;

    // 2. Parse PDF
    const filePath = path.join(booksDir, file);
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = (await new PDFParse(dataBuffer)) as any;
    
    // 3. Chunk and Embed
    const text = pdfData.text;
    const chunks = splitIntoChunks(text, 1500); 
    
    for (const [index, chunk] of chunks.entries()) {
      console.log(`Embedding chunk ${index + 1}/${chunks.length}...`);

      // Get embedding from Gemini
      const result = await embeddingModel.embedContent(chunk);
      const embedding = result.embedding.values;

      // Insert into Supabase
      const { error: chunkError } = await supabaseAdmin
        .from('chunks')
        .insert({
          document_id: doc.id,
          content: chunk,
          embedding: embedding,
          page: index // Simple approximation
        });

      if (chunkError) console.error('Chunk insertion error:', chunkError);
    }
    console.log(`Finished ${file}`);
  }
}

ingestBooks().catch(console.error);