import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export class DndTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;

  // D&D-specific section headers as proper JS RegExp patterns
  private static readonly SECTION_HEADER_PATTERN = new RegExp(
    [
      "^#\\s.*$", // Chapter titles (e.g., "# Monsters")
      "^##\\s.*$", // Section titles (e.g., "## Actions")
      "^###\\s.*$", // Sub-section titles (e.g., "### Stats")
      "^(Actions|Reactions|Traits|Lore|Stats)\\s*:?$", // D&D-specific sections
    ].join("|"),
    "m", // multiline flag so ^ and $ match line boundaries
  );

  constructor(chunkSize: number = 1000, chunkOverlap: number = 100) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  async splitText(text: string): Promise<string[]> {
    // Step 1: Split on D&D section headers first (structure-aware split)
    const sectionChunks = text
      .split(DndTextSplitter.SECTION_HEADER_PATTERN)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);

    // Step 2: For chunks still exceeding chunkSize, fall back to
    // RecursiveCharacterTextSplitter with D&D-aware separators
    const fallbackSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      separators: [
        "\n\n", // Paragraph breaks
        "\n", // Line breaks
        ". ", // Sentence endings
        ", ", // Clause breaks
        " ", // Word boundaries
        "", // Character-level fallback
      ],
    });

    const results: string[] = [];

    for (const chunk of sectionChunks) {
      if (chunk.length > this.chunkSize) {
        // Oversized section → recursive split
        const subChunks = await fallbackSplitter.splitText(chunk);
        results.push(...subChunks);
      } else {
        results.push(chunk);
      }
    }

    return results;
  }

  // Convenience: split and return as LangChain Document objects
  async createDocuments(
    texts: string[],
    metadatas?: Record<string, unknown>[],
  ) {
    const fallbackSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });

    const allChunks: string[] = [];
    for (const text of texts) {
      const chunks = await this.splitText(text);
      allChunks.push(...chunks);
    }

    return fallbackSplitter.createDocuments(allChunks, metadatas);
  }
}

export default DndTextSplitter;
