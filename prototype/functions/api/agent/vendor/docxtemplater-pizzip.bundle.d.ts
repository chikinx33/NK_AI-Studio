// docxtemplater-pizzip.bundle.js 의 타입 선언(최소). 실제 구현은 번들 파일에 있다.
export declare class PizZip {
  constructor(data?: ArrayBuffer | Uint8Array | string, options?: any);
  file(name: string): any;
  file(name: string, data: any, options?: any): any;
  files: Record<string, any>;
  generate(options?: any): any;
}
export declare class Docxtemplater {
  constructor(zip: PizZip, options?: any);
  render(data?: any): void;
  getZip(): PizZip;
}
