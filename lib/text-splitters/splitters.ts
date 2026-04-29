import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { DndTextSplitter } from "./dnd-splitter";
import { parseDndTables, createDocumentFromTable } from "./table-splitters";

export type SplitterType = "dnd" | "standard" | "table";

export interface SplitterConfig {
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Common interface so callers don't need to know which splitter they got.
 * All three variants expose an async splitText → string[] and an async
 * createDocuments → Document[] method.
 */
export interface DndSplitter {
  splitText(text: string): Promise<string[]>;
  createDocuments(
    texts: string[],
    metadatas?: Record<string, unknown>[],
  ): Promise<Document[]>;
}

export class SplitterFactory {
  static create(type: SplitterType, config: SplitterConfig): DndSplitter {
    switch (type) {
      case "dnd":
        return new DndTextSplitter(config.chunkSize, config.chunkOverlap);

      case "standard":
        // RecursiveCharacterTextSplitter is the concrete, non-abstract replacement
        return new RecursiveCharacterTextSplitter({
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          // D&D-aware separator hierarchy
          separators: ["\n\n", "\n", ". ", ", ", " ", ""],
        });

      case "table":
        return new TableSplitter(config.chunkSize, config.chunkOverlap);

      default:
        return new DndTextSplitter(config.chunkSize, config.chunkOverlap);
    }
  }
}

export class TableSplitter implements DndSplitter {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(chunkSize: number, chunkOverlap: number) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  async splitText(text: string): Promise<string[]> {
    const docs = await this.splitToDocuments(text);
    return docs.map((d) => d.pageContent);
  }

  async createDocuments(
    texts: string[],
    metadatas?: Record<string, unknown>[],
  ): Promise<Document[]> {
    const all: Document[] = [];
    for (let i = 0; i < texts.length; i++) {
      const docs = await this.splitToDocuments(texts[i]);
      // Merge caller-supplied metadata onto each produced document
      const extra = metadatas?.[i] ?? {};
      all.push(
        ...docs.map(
          (d) =>
            new Document({
              pageContent: d.pageContent,
              metadata: { ...d.metadata, ...extra },
            }),
        ),
      );
    }
    return all;
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async splitToDocuments(text: string): Promise<Document[]> {
    const documents: Document[] = [];

    // 1. Extract and convert Markdown tables first
    const tables = parseDndTables(text);
    for (const table of tables) {
      documents.push(createDocumentFromTable(table));
    }

    // 2. Strip table rows from the remaining prose so they aren't double-counted.
    //    Also remove ATX headings that were already captured as section headers.
    const remainingText = text
      .replace(/^\|.*\|[ \t]*$/gm, "") // remove table rows
      .replace(/^#{1,3}\s.*$/gm, "") // remove headings
      .replace(/\n{3,}/g, "\n\n") // collapse excess blank lines
      .trim();

    // 3. Split leftover prose with overlap-aware chunking
    if (remainingText.length > 0) {
      const textChunks = this.chunkWithOverlap(remainingText);
      for (const chunk of textChunks) {
        documents.push(
          new Document({
            pageContent: chunk,
            metadata: { chunkType: "text" },
          }),
        );
      }
    }

    return documents;
  }

  /**
   * Naive but overlap-aware chunker.
   * Prefers splitting on paragraph/sentence boundaries within the window.
   */
  private chunkWithOverlap(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      let slice = text.slice(start, end);

      // If we're not at the end, try to break on a natural boundary
      if (end < text.length) {
        const lastPara = slice.lastIndexOf("\n\n");
        const lastLine = slice.lastIndexOf("\n");
        const lastSentence = slice.lastIndexOf(". ");

        const breakAt =
          lastPara > this.chunkSize * 0.5
            ? lastPara + 2
            : lastLine > this.chunkSize * 0.5
              ? lastLine + 1
              : lastSentence > this.chunkSize * 0.5
                ? lastSentence + 2
                : slice.length; // no good break → hard cut

        slice = slice.slice(0, breakAt).trim();
      }

      if (slice.length > 0) {
        chunks.push(slice);
      }

      // Advance by (breakpoint − overlap) so the next chunk shares context
      start += Math.max(slice.length - this.chunkOverlap, 1);
    }

    return chunks;
  }
}

export default SplitterFactory;
