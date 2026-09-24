declare module "@quark/html-engine" {
  export function normalize(doc: any): any;
  export function patchNode(doc: any, id: string, patch: any): any;
  export function deleteNode(doc: any, id: string): any;
  export function compile(
    pages: any[],
    options?: any,
  ): { html: string; diagnostics: any[] };
  export function editablePreview(doc: any, channel: string): string;
}
