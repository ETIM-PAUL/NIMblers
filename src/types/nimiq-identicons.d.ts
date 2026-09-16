// @nimiq/identicons ships no type declarations — this covers only the
// static methods this app actually calls (see its README for the rest).
declare module '@nimiq/identicons' {
  export default class Identicons {
    static svgPath: string
    static toDataUrl(text: string): Promise<string>
    static placeholderToDataUrl(color?: string, strokeWidth?: number): string
  }
}
