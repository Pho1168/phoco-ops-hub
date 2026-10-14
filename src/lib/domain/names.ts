/** "Minh Nguyen" → "MN"; a label in brackets, like "(demo)", doesn't count. */
export const initials = (name: string) =>
  name.split(/\s+/).filter((w) => w && !w.startsWith("(")).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** "Minh Nguyen (demo)" → "Minh". */
export const firstName = (name: string) => name.split(/\s+/).find((w) => w && !w.startsWith("(")) ?? name;
