// Display text helpers. ERO, EFIN and PTIN are acronyms and are always written in capitals (plurals: EROs, EFINs, PTINs).
export const acronyms = (text: string) => text.replace(/\b(ero|efin|ptin)(s?)\b/gi, (_m, word: string, plural: string) => word.toUpperCase() + plural.toLowerCase());

/** "ero" -> "ERO", "responsible_official" -> "Responsible official" for labels and messages. */
export const words = (value: string) => acronyms(value.replace(/_/g, " "));
export const sentence = (value: string) => words(value).replace(/^\w/, (c) => c.toUpperCase());
