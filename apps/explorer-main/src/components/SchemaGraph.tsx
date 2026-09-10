import {
  createEffect,
  createUniqueId,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
  SolidFlow,
  SolidFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  MarkerType,
  useSolidFlow,
  useInternalNode,
  useUpdateNodeInternals,
  useNodesInitialized,
  useViewportInitialized,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from "@dschz/solid-flow";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import "@dschz/solid-flow/styles";
import {
  expressionTerms,
  sourceDefinition,
  type SchemaReference,
} from "../schema-expression";
import type { SchemaLink, SchemaNode } from "../types";

// elk.bundled.js lays out in-process through a fake worker that only
// implements postMessage/onmessage, while ELK#terminateWorker assumes a real
// Worker and throws "terminate is not a function". A throwing cleanup aborts
// SolidJS disposal for the whole subtree, which froze profile switching once a
// graph had rendered. Only terminate workers that can actually be terminated.
const releaseLayoutEngine = (engine: InstanceType<typeof ELK>) => {
  const worker = (
    engine as unknown as { worker?: { worker?: { terminate?: unknown } } }
  ).worker?.worker;
  if (typeof worker?.terminate === "function") engine.terminateWorker();
};

type Inspection = {
  title: string;
  refs: SchemaReference[];
  explanation?: string;
};

type CardData = {
  inspect?: () => void;
  label: string;
  kind: string;
  detail?: string;
  ports: { id: string; x: number; y: number; source: boolean }[];
};
function Card(props: NodeProps<CardData>): JSX.Element {
  let pointerStart = { x: 0, y: 0 };
  return (
    <>
      <div
        class={`schema-flow-card schema-flow-card--${props.data.kind}`}
        role="button"
        tabIndex={0}
        aria-label={`Show source for ${props.data.label}`}
        onPointerDown={(event) => {
          pointerStart = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          if (
            event.detail === 0 ||
            Math.hypot(
              event.clientX - pointerStart.x,
              event.clientY - pointerStart.y,
            ) < 5
          )
            props.data.inspect?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            props.data.inspect?.();
          }
        }}
      >
        <span class="schema-flow-card__kind">{props.data.kind}</span>
        <strong>{props.data.label}</strong>
        <Show when={props.data.detail}>
          <span class="schema-flow-card__detail">{props.data.detail}</span>
        </Show>
      </div>
      <For each={props.data.ports}>
        {(port) => (
          <Handle
            id={port.id}
            type={port.source ? "source" : "target"}
            position={port.source ? Position.Right : Position.Left}
            isConnectable={false}
            style={{
              left: `${port.x}px`, top: `${port.y}px`, right: "auto",
              // ELK supplies the handle center on either side. Override the
              // library's right-side +50% translation when using explicit left.
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
      </For>
    </>
  );
}
function RoutedEdge(
  props: EdgeProps<{
    path: string;
    lane?: number;
    inspect?: () => void;
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    label?: {
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>,
): JSX.Element {
  const sourceNode = useInternalNode(() => props.source);
  const targetNode = useInternalNode(() => props.target);
  const geometry = createMemo(() => {
    const data = props.data;
    const dx = (sourceNode()?.position.x ?? 0) - (data?.start?.x ?? 0);
    const dy = (sourceNode()?.position.y ?? 0) - (data?.start?.y ?? 0);
    const moved =
      Math.abs(dx) +
        Math.abs(dy) +
        Math.abs((targetNode()?.position.x ?? 0) - (data?.end?.x ?? 0)) +
        Math.abs((targetNode()?.position.y ?? 0) - (data?.end?.y ?? 0)) >
      1;
    if (!moved) return { path: data?.path ?? "", label: data?.label };
    // Preserve ELK's separate routing lanes. Recomputing each edge independently
    // after a drag gives sibling edges the same midpoint and merges their trunks.
    const original = [
      ...(data?.path ?? "").matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g),
    ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    const points = original.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    }));
    if (props.source !== props.target && points.length >= 2) {
      const last = points.length - 1;
      const targetDx = (targetNode()?.position.x ?? 0) - (data?.end?.x ?? 0);
      const targetDy = (targetNode()?.position.y ?? 0) - (data?.end?.y ?? 0);
      points[last] = {
        x: original[last].x + targetDx,
        y: original[last].y + targetDy,
      };
      if (last > 1) {
        if (original[last - 1].y === original[last].y)
          points[last - 1].y = points[last].y;
        else points[last - 1].x = points[last].x;
      }
      // A formerly straight edge needs an elbow when its endpoints change rows.
      if (
        points.length === 2 &&
        points[0].y !== points[1].y &&
        points[0].x !== points[1].x
      ) {
        const lane = original[0].x + 28 + (data?.lane ?? 0) * 22 + dx;
        points.splice(
          1,
          0,
          { x: lane, y: points[0].y },
          { x: lane, y: points[1].y },
        );
      }
    }
    let label = data?.label
      ? { ...data.label, x: data.label.x + dx, y: data.label.y + dy }
      : undefined;
    if (label && props.source !== props.target) {
      const segments = points
        .slice(1)
        .map((point, i) => ({ a: points[i], b: point }))
        .filter(({ a, b }) => a.y === b.y);
      const segment =
        segments
          .filter(({ a, b }) => Math.abs(b.x - a.x) >= label!.width + 16)
          .at(-1) ??
        segments.sort(
          (a, b) => Math.abs(b.b.x - b.a.x) - Math.abs(a.b.x - a.a.x),
        )[0];
      if (segment)
        label = {
          ...label,
          x: (segment.a.x + segment.b.x - label.width) / 2,
          y: segment.a.y + 7,
        };
    }
    return {
      path: points
        .map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`)
        .join(" "),
      label,
    };
  });
  return (
    <>
      <path
        d={geometry().path}
        fill="none"
        stroke="var(--panel)"
        stroke-width="6"
        pointer-events="none"
      />
      <BaseEdge
        path={geometry().path}
        markerEnd={props.markerEnd}
        class="schema-flow-edge"
        style={{ stroke: "var(--accent)", "stroke-width": 1.8 }}
      />
      <Show when={geometry().label}>
        {(label) => (
          <g
            class="schema-flow-operator"
            role="button"
            tabIndex={0}
            aria-label={`Show source for ${label().text}`}
            onClick={() => props.data?.inspect?.()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                props.data?.inspect?.();
              }
            }}
            transform={`translate(${label().x}, ${label().y})`}
          >
            <rect width={label().width} height={label().height} rx="5" />
            <text
              x={label().width / 2}
              y={label().height / 2}
              text-anchor="middle"
              dominant-baseline="central"
            >
              {label().text}
            </text>
          </g>
        )}
      </Show>
    </>
  );
}
const nodeTypes = { schema: Card };
const edgeTypes = { routed: RoutedEdge };
interface GraphProps {
  focusType?: string;
  focusMember?: string;
  focusKind?: "relation" | "permission";
  focusVersion?: number;
  embedded?: boolean;
  source: string;
  nodes: SchemaNode[];
  links: SchemaLink[];
}
interface ModelNode {
  inspection?: Inspection;
  id: string;
  label: string;
  kind: string;
  detail?: string;
}
interface ModelEdge {
  inspection?: Inspection;
  label?: string;
  operator?: string;
  id: string;
  source: string;
  target: string;
}

function Graph(props: GraphProps): JSX.Element {
  const [mode, setMode] = createSignal("relations");
  const [type, setType] = createSignal(props.focusType ?? "all");
  const modeGroup = createUniqueId();
  createEffect(() => {
    if (props.focusType) setType(props.focusType);
  });
  const [permission, setPermission] = createSignal("view");
  createEffect(() => {
    void props.focusVersion;
    if (props.focusKind)
      setMode(props.focusKind === "relation" ? "relations" : "permissions");
    if (props.focusKind === "permission" && props.focusMember)
      setPermission(props.focusMember);
  });
  const [wheelActive, setWheelActive] = createSignal(false);
  const [inspection, setInspection] = createSignal<Inspection>();
  const [busy, setBusy] = createSignal(true);
  const [error, setError] = createSignal("");
  const [nodes, setNodes] = createStore<Node[]>([]);
  const [edges, setEdges] = createStore<Edge[]>([]);
  const flow = useSolidFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const elk = new ELK();
  const nodesReady = useNodesInitialized();
  const viewportReady = useViewportInitialized();
  let generation = 0;
  let canvas!: HTMLDivElement;
  let observer: ResizeObserver | undefined;
  const activateGraph = (event: PointerEvent) =>
    setWheelActive(Boolean(canvas?.contains(event.target as HTMLElement)));
  onMount(() => document.addEventListener("pointerdown", activateGraph));
  onCleanup(() => document.removeEventListener("pointerdown", activateGraph));
  const activeType = createMemo(
    () =>
      props.nodes.find((node) => node.id === type()) ??
      props.nodes.find((node) => node.id === "server") ??
      props.nodes[0],
  );
  const definitions = () => activeType()?.permissionDefinitions ?? [];
  const activePermission = () =>
    definitions().find((item) => item.name === permission()) ??
    definitions()[0];
  const fit = () =>
    void flow.fitView({ padding: 0.05, maxZoom: 1.6, duration: 0 });
  const frameGraph = () => {
    if (canvas?.clientWidth < 600 && nodes.length) {
      // A fitted overview makes phone labels illegible. Start at a readable
      // scale; the explicit Fit Graph control still offers the whole overview.
      const root =
        nodes.find(
          (node) => node.id === `type:${type() === "all" ? "server" : type()}`,
        ) ?? nodes[0];
      void flow.setViewport({
        x: 20 - root.position.x * 0.9,
        y: canvas.clientHeight / 2 - root.position.y * 0.9,
        zoom: 0.9,
      });
    } else fit();
  };
  createEffect(() => {
    if (nodesReady() && viewportReady() && !busy())
      requestAnimationFrame(frameGraph);
  });
  const model = createMemo(() => {
    const ns: ModelNode[] = [];
    const es: ModelEdge[] = [];
    const connect = (source: string, target: string, operator?: string) =>
      es.push({ id: `expression:${encodeURIComponent(source)}:${encodeURIComponent(target)}:${es.length}`, source, target, operator });
    if (mode() === "relations") {
      const links = props.links.filter(
        (link) =>
          (type() === "all" || link.source === type()) &&
          (props.focusKind !== "relation" ||
            !props.focusMember ||
            link.label === props.focusMember),
      );
      const ids = new Set(
        type() === "all"
          ? props.nodes.map((node) => node.id)
          : [type(), ...links.map((link) => link.target)],
      );
      for (const id of ids)
        ns.push({
          inspection: { title: id, refs: [{ type: id }] },
          id: `type:${id}`,
          label: id,
          kind: "type",
          detail: props.nodes
            .find((node) => node.id === id)
            ?.permissions.join(" · "),
        });
      links.forEach((link) => {
        es.push({
          id: `relation:${[link.source, link.label, link.target].map(encodeURIComponent).join(":")}`,
          source: `type:${link.source}`,
          target: `type:${link.target}`,
          label: link.label,
          inspection: {
            title: `${link.source}.${link.label}`,
            refs: [{ type: link.source, member: link.label }],
            explanation: `${link.source} → ${link.target}`,
          },
        });
      });
    } else {
      const owner = activeType();
      const definition = activePermission();
      if (!owner || !definition) return { ns, es };
      const id = `permission:${owner.id}.${definition.name}`;
      ns.push({
        id,
        label: `${owner.id}.${definition.name}`,
        inspection: {
          title: `${owner.id}.${definition.name}`,
          refs: [{ type: owner.id, member: definition.name }],
        },
        kind: "permission",
      });
      expressionTerms(definition.expression).forEach(
        ({ term, operator }, index) => {
          const traversal = term.match(
            /^([A-Za-z_]\w*)\s*->\s*([A-Za-z_]\w*)$/,
          );
          const member = traversal?.[1] ?? term;
          const relations = props.links.filter(
            (link) => link.source === owner.id && link.label === member,
          );
          const local = `${id}:term:${index}:${encodeURIComponent(term)}`;
          ns.push({
            id: local,
            label: term,
            inspection: {
              title: `${owner.id}: ${term}`,
              refs: traversal
                ? [
                    { type: owner.id, member },
                    ...relations.map((link) => ({
                      type: link.target,
                      member: traversal[2],
                    })),
                  ]
                : [
                    {
                      type: owner.id,
                      member:
                        relations.length || owner.permissions.includes(term)
                          ? term
                          : definition.name,
                    },
                  ],
            },
            kind: traversal
              ? "path"
              : relations.length
                ? "relation"
                : owner.permissions.includes(term)
                  ? "permission"
                  : "expression",
            detail: traversal
              ? relations
                  .map((link) => `${link.target}.${traversal[2]}`)
                  .join(" · ")
              : undefined,
          });
          connect(id, local, operator);
          es[es.length - 1].inspection = {
            title: `${owner.id}.${definition.name}`,
            refs: [{ type: owner.id, member: definition.name }],
            explanation: `${operator === "=" ? "First term" : operator === "+" ? "Union" : operator === "-" ? "Exclusion" : "Intersection"}: ${term}`,
          };
        },
      );
    }
    return { ns, es };
  });
  createEffect(() => {
    const { ns, es } = model();
    setInspection(undefined);
    const current = ++generation;
    setBusy(true);
    setError("");
    const graph: ElkNode = {
      id: "schema",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "32",
        "elk.layered.spacing.nodeNodeBetweenLayers":
          mode() === "permissions" ? "120" : "45",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
        "elk.spacing.edgeEdge": "18",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
        "elk.layered.mergeEdges": "false",
        "elk.padding": "[top=24,left=24,bottom=24,right=24]",
      },
      children: ns.map((node) => ({
        id: node.id,
        width: Math.max(
          node.kind === "type" ? 130 : 110,
          node.label.length * 9 + 26,
        ),
        height: node.detail ? 78 : 58,
        layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
        ports: es.flatMap((edge) => [
          ...(edge.source === node.id
            ? [
                {
                  id: `${edge.id}:out`,
                  width: 0,
                  height: 0,
                  layoutOptions: { "elk.port.side": "EAST" },
                },
              ]
            : []),
          ...(edge.target === node.id
            ? [
                {
                  id: `${edge.id}:in`,
                  width: 0,
                  height: 0,
                  layoutOptions: { "elk.port.side": "WEST" },
                },
              ]
            : []),
        ]),
      })),
      edges: es.map((edge) => ({
        id: edge.id,
        sources: [`${edge.id}:out`],
        targets: [`${edge.id}:in`],
        labels:
          edge.operator || edge.label
            ? [
                {
                  text:
                    edge.label ??
                    (
                      {
                        "=": "=",
                        "+": "+ union",
                        "-": "- exclude",
                        "&": "& intersect",
                      } as Record<string, string>
                    )[edge.operator!],
                  width: edge.label
                    ? edge.label.length * 8 + 20
                    : edge.operator === "="
                      ? 28
                      : 100,
                  height: 26,
                  layoutOptions: { "elk.edgeLabels.placement": "CENTER" },
                },
              ]
            : [],
      })),
    };
    void elk
      .layout(graph)
      .then((result) => {
        if (current !== generation) return;
        setNodes(
          reconcile(
            (result.children ?? []).map((node) => ({
              id: node.id,
              type: "schema",
              position: { x: node.x ?? 0, y: node.y ?? 0 },
              width: node.width,
              height: node.height,
              style: { width: `${node.width}px`, height: `${node.height}px` },
              data: {
                ...ns.find((item) => item.id === node.id)!,
                inspect: () =>
                  setInspection(
                    ns.find((item) => item.id === node.id)?.inspection,
                  ),
                ports: (node.ports ?? []).map((port) => ({
                  id: port.id,
                  x: port.x ?? 0,
                  y: port.y ?? 0,
                  source: port.id.endsWith(":out"),
                })),
              },
            })),
          ),
        );
        setEdges(
          reconcile(
            (result.edges ?? []).map((edge) => {
              const original = es.find((item) => item.id === edge.id)!;
              const path = (edge.sections ?? [])
                .map((section) =>
                  [
                    section.startPoint,
                    ...(section.bendPoints ?? []),
                    section.endPoint,
                  ]
                    .map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`)
                    .join(" "),
                )
                .join(" ");
              return {
                ...original,
                type: "routed",
                ariaRole: "group",
                sourceHandle: `${edge.id}:out`,
                targetHandle: `${edge.id}:in`,
                markerEnd: { type: MarkerType.ArrowClosed, color: "#348568" },
                data: {
                  path,
                  lane: es
                    .filter((item) => item.source === original.source)
                    .findIndex((item) => item.id === original.id),
                  label: edge.labels?.[0],
                  start: result.children?.find(
                    (node) => node.id === original.source,
                  ),
                  end: result.children?.find(
                    (node) => node.id === original.target,
                  ),
                  inspect: () => setInspection(original.inspection),
                },
              };
            }),
          ),
        );
        setBusy(false);
        requestAnimationFrame(() => {
          if (current !== generation) return;
          updateNodeInternals(ns.map(node => node.id));
          requestAnimationFrame(() => { if (current === generation) frameGraph(); });
        });
      })
      .catch((reason) => {
        if (current === generation) {
          setError(String(reason));
          setBusy(false);
        }
      });
  });
  onCleanup(() => {
    generation++;
    observer?.disconnect();
    releaseLayoutEngine(elk);
  });
  return (
    <div class="schema-flow">
      <div class="schema-flow-toolbar">
        <div class="schema-flow-modes" aria-label="Graph view">
          <For each={["relations", "permissions"]}>
            {(value) => (
              <Show
                when={props.embedded}
                fallback={
                  <button
                    type="button"
                    class="pagination-button"
                    aria-pressed={mode() === value}
                    onClick={() => setMode(value)}
                  >
                    {value === "relations" ? "Relations" : "Permissions"}
                  </button>
                }
              >
                <label class="schema-mode-radio">
                  <input
                    type="radio"
                    name={modeGroup}
                    value={value}
                    checked={mode() === value}
                    onChange={() => setMode(value)}
                  />
                  {value === "relations" ? "Relations" : "Permissions"}
                </label>
              </Show>
            )}
          </For>
        </div>
        <Show when={!props.focusType}>
          <label>
            Type{" "}
            <select
              aria-label="Graph resource type"
              value={mode() === "permissions" ? activeType()?.id : type()}
              onChange={(event) => setType(event.currentTarget.value)}
            >
              <Show when={mode() === "relations"}>
                <option value="all">All Types</option>
              </Show>
              <For each={props.nodes}>
                {(node) => <option value={node.id}>{node.id}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={mode() === "permissions"}>
          <label>
            Permission{" "}
            <select
              aria-label="Graph permission"
              value={activePermission()?.name ?? ""}
              onChange={(event) => setPermission(event.currentTarget.value)}
            >
              <For each={definitions()}>
                {(definition) => (
                  <option value={definition.name}>{definition.name}</option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <button type="button" class="pagination-button" onClick={fit}>
          Fit Graph
        </button>
      </div>
      <div class="schema-flow-caption">
        <Show
          when={mode() === "permissions"}
          fallback={
            <span>
              Edges name the relation from a type to its subject type. Select a
              type to isolate its relations.
            </span>
          }
        >
          <Show
            when={activePermission()}
            fallback={<span>This type defines no permissions.</span>}
          >
            {(definition) => (
              <>
                <code>
                  {definition().name} = {definition().expression}
                </code>
                <span>
                  Permission = terms, read from top to bottom. Parentheses
                  preserve grouping.
                </span>
              </>
            )}
          </Show>
        </Show>
      </div>
      <div
        class="schema-flow-canvas"
        ref={canvas}
        aria-label="Schema connections"
        aria-busy={busy()}
        data-wheel-zoom={wheelActive()}
        onFocusIn={() => setWheelActive(true)}
      >
        <SolidFlow
          fitView
          fitViewOptions={{ padding: 0.05, maxZoom: 1.6 }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesFocusable={false}
          edgesFocusable={false}
          onEdgeClick={({ edge }) =>
            (edge.data?.inspect as (() => void) | undefined)?.()
          }
          nodesDraggable={true}
          nodesConnectable={false}
          deleteKey={null}
          minZoom={0.15}
          maxZoom={2}
          zoomOnScroll={wheelActive()}
          onPaneClick={() => setInspection(undefined)}
          onInit={() => {
            observer = new ResizeObserver(() => {
              if (canvas.clientWidth && canvas.clientHeight)
                requestAnimationFrame(frameGraph);
            });
            observer.observe(canvas);
          }}
        >
          <Background />
          <Controls
            showLock={false}
            fitViewOptions={{ padding: 0.05, maxZoom: 1.6 }}
          />
        </SolidFlow>
        <Show when={inspection()}>
          {(selected) => (
            <aside
              class="schema-source-detail nowheel nopan"
              aria-label="Source Definition"
            >
              <div class="schema-source-detail__heading">
                <strong>Source Definition</strong>
                <button
                  type="button"
                  class="pagination-button"
                  aria-label="Close source details"
                  onClick={() => setInspection(undefined)}
                >
                  Close
                </button>
              </div>
              <strong>{selected().title}</strong>
              <Show when={selected().explanation}>
                <p>{selected().explanation}</p>
              </Show>
              <For each={selected().refs}>
                {(reference) => {
                  const excerpt = () =>
                    sourceDefinition(props.source, reference);
                  return (
                    <div class="schema-source-detail__excerpt">
                      <span>
                        {reference.type}
                        {reference.member ? `.${reference.member}` : ""}
                        <Show when={excerpt()}> · Line {excerpt()?.line}</Show>
                      </span>
                      <pre>
                        {excerpt()?.text ??
                          "Definition not found in the published source."}
                      </pre>
                    </div>
                  );
                }}
              </For>
            </aside>
          )}
        </Show>
        <Show when={busy()}>
          <div class="schema-flow-status" role="status">
            Laying out schema…
          </div>
        </Show>
        <Show when={error()}>
          <div class="schema-flow-status" role="alert">
            Unable to lay out graph: {error()}
          </div>
        </Show>
      </div>
      <p class="section-meta">
        Select a node or edge to see its source. Drag nodes to rearrange; drag
        the canvas to pan. Use + / − to zoom.{" "}
        {wheelActive()
          ? "Scroll to zoom."
          : "Click the graph to enable wheel zoom."}{" "}
      </p>
    </div>
  );
}
export default function SchemaGraph(props: GraphProps): JSX.Element {
  return (
    <SolidFlowProvider>
      <Graph {...props} />
    </SolidFlowProvider>
  );
}
