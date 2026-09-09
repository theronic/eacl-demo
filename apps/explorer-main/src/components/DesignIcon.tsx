import type { JSX } from "solid-js";
// Icons from the approved design preview.
const icons: Record<string, string> = {
  shield:
    '<path d="M12 3 20 6v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  tree: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v9h9M6 13h12V9"/>',
  schema:
    '<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="16" width="7" height="6" rx="1"/><rect x="15" y="16" width="7" height="6" rx="1"/><path d="M12 8v4H5v4m7-4h7v4"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 3v7h-7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  density: '<path d="M4 5h16M4 12h16M4 19h16M7 3v4M17 10v4M7 17v4"/>',
  account:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 6"/>',
  vpc: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v5H5v3m7-3h7v3"/>',
  server:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M6 6.5h.1M6 17.5h.1M10 6.5h7m-7 11h7"/>',
  platform: '<path d="m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6"/>',
  layers: '<path d="m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
export function DesignIcon(props: { name: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      innerHTML={icons[props.name] ?? icons.server}
    />
  );
}
