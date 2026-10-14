import chromeLensOcr from "chrome-lens-ocr";

const Lens =
  typeof chromeLensOcr === "function"
    ? chromeLensOcr
    : (chromeLensOcr as any).default || chromeLensOcr;

let sharedLensInstance: any = null;

export function getLensInstance(): any {
  if (!sharedLensInstance) {
    sharedLensInstance = new Lens();
  }
  return sharedLensInstance;
}
