/** subset-font（BSD-3-Clause）は型を持たないので、使う分だけを宣言する。 */
declare module 'subset-font' {
  interface SubsetOptions {
    targetFormat?: 'woff2' | 'woff' | 'sfnt' | 'truetype';
  }
  function subsetFont(font: Uint8Array, text: string, options?: SubsetOptions): Promise<Uint8Array>;
  export default subsetFont;
}
