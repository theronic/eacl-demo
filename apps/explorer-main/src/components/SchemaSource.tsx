import { createMemo, For, Show } from "solid-js";

export function SchemaSource(props: {
  source: string;
  selected?: string;
  selectedMember?: string;
  onSelect: (
    type: string,
    member?: string,
    kind?: "relation" | "permission",
  ) => void;
}) {
  const blocks = createMemo(() => {
    const matches = [
      ...props.source.matchAll(/^definition\s+([A-Za-z_]\w*)\s*\{/gm),
    ];
    return matches.map((match, index) => {
      const text = props.source.slice(
        match.index,
        matches[index + 1]?.index ?? props.source.length,
      );
      const newline = text.indexOf("\n");
      return {
        type: match[1],
        heading: newline < 0 ? text : text.slice(0, newline),
        body: newline < 0 ? "" : text.slice(newline),
      };
    });
  });
  return (
    <div
      id="schema-editor"
      class="schema-editor schema-source"
      role="region"
      aria-label="Spice Schema"
      tabIndex={0}
    >
      <For each={blocks()} fallback={<pre>{props.source}</pre>}>
        {(block) => (
          <pre
            class="schema-source-definition"
            data-selected={props.selected === block.type}
          >
            <button
              type="button"
              class="schema-definition-link"
              aria-label={`Focus ${block.type} definition`}
              aria-pressed={
                props.selected === block.type && !props.selectedMember
              }
              onClick={() => props.onSelect(block.type)}
            >
              {block.heading}
            </button>
            <For each={block.body.split("\n")}>
              {(line, index) => {
                const member = line.match(
                  /^(\s*)(relation|permission)\s+([A-Za-z_]\w*)/,
                );
                return (
                  <>
                    {index() > 0 ? "\n" : ""}
                    <Show when={member} fallback={line}>
                      {(match) => (
                        <button
                          type="button"
                          class="schema-definition-link schema-member-link"
                          aria-label={`Focus ${block.type} ${match()[2]} ${match()[3]}`}
                          aria-pressed={
                            props.selected === block.type &&
                            props.selectedMember === match()[3]
                          }
                          onClick={() =>
                            props.onSelect(
                              block.type,
                              match()[3],
                              match()[2] as "relation" | "permission",
                            )
                          }
                        >
                          {line}
                        </button>
                      )}
                    </Show>
                  </>
                );
              }}
            </For>
          </pre>
        )}
      </For>
    </div>
  );
}
