// Display text helpers. ERO, EFIN and PTIN are acronyms and are always written in capitals (plurals: EROs, EFINs, PTINs).
export const acronyms = (text: string) => text.replace(/\b(ero|efin|ptin)(s?)\b/gi, (_m, word: string, plural: string) => word.toUpperCase() + plural.toLowerCase());

/** "ero" -> "ERO", "responsible_official" -> "Responsible official" for labels and messages. */
export const words = (value: string) => acronyms(value.replace(/_/g, " "));
export const sentence = (value: string) => words(value).replace(/^\w/, (c) => c.toUpperCase());

const STRUCTURE: Record<string, string> = { llc: "LLC", corporation: "Corporation", s_corporation: "S corporation", partnership: "Partnership", sole_proprietorship: "Sole proprietorship", nonprofit: "Nonprofit", other: "Other" };
/** "llc" -> "LLC", "s_corporation" -> "S corporation". */
export const structureLabel = (value: string | null | undefined) => (value ? (STRUCTURE[value] ?? sentence(value)) : "");
export const STRUCTURE_OPTIONS = Object.entries(STRUCTURE).map(([value, label]) => ({ value, label }));
