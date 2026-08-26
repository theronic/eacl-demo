import { createEffect, on, onCleanup, onMount, type JSX } from "solid-js";
import * as d3 from "d3";
import type { SchemaLink, SchemaNode } from "../types";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  permissions: string[];
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  label: string;
}

export default function SchemaGraph(props: {
  nodes: SchemaNode[];
  links: SchemaLink[];
}): JSX.Element {
  let svg!: SVGSVGElement;
  let simulation: d3.Simulation<GraphNode, GraphLink> | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const renderGraph = () => {
    if (!svg) return;
    simulation?.stop();
    const width = Math.max(320, svg.parentElement?.clientWidth ?? 640);
    const height = 430;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const root = d3.select(svg);
    root.selectAll("*").remove();

    const nodes: GraphNode[] = props.nodes.map((node) => ({ ...node }));
    const links: GraphLink[] = props.links.map((link) => ({ ...link }));
    const link = root
      .append("g")
      .attr("class", "schema-graph__links")
      .selectAll("line")
      .data(links)
      .join("line");
    const labels = root
      .append("g")
      .attr("class", "schema-graph__labels")
      .selectAll("text")
      .data(links)
      .join("text")
      .text((item) => item.label);
    const node = root
      .append("g")
      .attr("class", "schema-graph__nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (item) => item.id)
      .join("g");

    node.append("circle").attr("r", 25);
    node
      .append("text")
      .attr("class", "schema-graph__node-title")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .text((item) => item.id);
    node
      .append("text")
      .attr("class", "schema-graph__node-permissions")
      .attr("text-anchor", "middle")
      .attr("dy", "38px")
      .text((item) => item.permissions.map((value) => `:${value}`).join(" · "));

    simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((item) => item.id)
          .distance(120),
      )
      .force("charge", d3.forceManyBody().strength(-420))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(54));

    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, item) => {
        if (!event.active) simulation?.alphaTarget(0.3).restart();
        item.fx = item.x;
        item.fy = item.y;
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) simulation?.alphaTarget(0);
        item.fx = null;
        item.fy = null;
      });
    node.call(drag);

    simulation.on("tick", () => {
      link
        .attr("x1", (item) => (item.source as GraphNode).x ?? 0)
        .attr("y1", (item) => (item.source as GraphNode).y ?? 0)
        .attr("x2", (item) => (item.target as GraphNode).x ?? 0)
        .attr("y2", (item) => (item.target as GraphNode).y ?? 0);
      labels
        .attr(
          "x",
          (item) =>
            (((item.source as GraphNode).x ?? 0) +
              ((item.target as GraphNode).x ?? 0)) /
            2,
        )
        .attr(
          "y",
          (item) =>
            (((item.source as GraphNode).y ?? 0) +
              ((item.target as GraphNode).y ?? 0)) /
            2,
        );
      node.attr("transform", (item) => `translate(${item.x ?? 0},${item.y ?? 0})`);
    });
  };

  onMount(() => {
    resizeObserver = new ResizeObserver(renderGraph);
    if (svg.parentElement) resizeObserver.observe(svg.parentElement);
    renderGraph();
  });
  createEffect(
    on(
      () => [props.nodes, props.links] as const,
      () => queueMicrotask(renderGraph),
      { defer: true },
    ),
  );
  onCleanup(() => {
    resizeObserver?.disconnect();
    simulation?.stop();
    d3.select(svg).selectAll("*").interrupt().remove();
  });

  return (
    <svg
      ref={svg}
      class="schema-graph"
      role="img"
      aria-label="Schema resource and relationship graph"
    />
  );
}
