import { OCRBlock } from "../types";

export interface SpeechUnit {
  speech_unit_id: string;
  pageIndex: number;
  regionIds: string[];
  blocks: OCRBlock[];
  sourceText: string;
  translatedText?: string;
  textType: string;
}

export function groupPageBlocksIntoSpeechUnits(
  blocks: OCRBlock[],
  pageIndex: number
): { speechUnits: SpeechUnit[]; updatedBlocks: OCRBlock[] } {
  const updatedBlocks = blocks.map((b, idx) => {
    const regionId = b.region_id || b.id || `p${pageIndex}_reg_${idx + 1}`;
    const unitId = `p${pageIndex}_unit_${idx + 1}`;
    return {
      ...b,
      id: regionId,
      region_id: regionId,
      speech_unit_id: unitId,
    };
  });

  const speechUnits: SpeechUnit[] = updatedBlocks
    .filter((b) => b.original && b.original.trim().length > 0)
    .map((b, idx) => ({
      speech_unit_id: (b as any).speech_unit_id || `p${pageIndex}_unit_${idx + 1}`,
      pageIndex,
      regionIds: [b.region_id!],
      blocks: [b],
      sourceText: b.original.trim(),
      translatedText: b.translated || "",
      textType: b.text_type || "dialogue",
    }));

  return { speechUnits, updatedBlocks };
}

export function applySpeechUnitTranslation(unit: SpeechUnit, translatedText: string): void {
  unit.translatedText = translatedText;
  for (const block of unit.blocks) {
    block.translated = translatedText;
  }
}
