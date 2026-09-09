/** Split only at top-level operators. Keep grouping and traversal intact, and
 * preserve order and repeated operands instead of reducing the expression to a set. */
export function expressionTerms(
  expression: string,
): { operator: string; term: string }[] {
  const terms: { operator: string; term: string }[] = [];
  let depth = 0;
  let start = 0;
  let operator = "=";
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (
      depth === 0 &&
      (char === "+" ||
        char === "&" ||
        (char === "-" && expression[i + 1] !== ">"))
    ) {
      terms.push({ operator, term: expression.slice(start, i).trim() });
      operator = char;
      start = i + 1;
    }
  }
  terms.push({ operator, term: expression.slice(start).trim() });
  const components = terms.filter((item) => item.term);
  // A union/intersection applies to every component, not just those following
  // the first separator. Equality belongs to the whole permission definition.
  const combination = components[1]?.operator;
  if ((combination === "+" || combination === "&") &&
      components.slice(1).every(item => item.operator === combination)) {
    components[0].operator = combination;
  }
  return components;
}

export interface SchemaReference {
  type: string;
  member?: string;
}

/** Read excerpts from the published source, retaining its original line numbers. */
export function sourceDefinition(source: string, reference: SchemaReference) {
  const lines = source.split("\n");
  const start = lines.findIndex(
    (line) => line.trim() === `definition ${reference.type} {`,
  );
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "}") end++;
  if (!reference.member)
    return { line: start + 1, text: lines.slice(start, end + 1).join("\n") };
  const index = lines.findIndex(
    (line, i) =>
      i > start &&
      i < end &&
      /^(relation|permission)\s/.test(line.trim()) &&
      line.trim().split(/[\s:=]+/)[1] === reference.member,
  );
  return index < 0 ? undefined : { line: index + 1, text: lines[index].trim() };
}
