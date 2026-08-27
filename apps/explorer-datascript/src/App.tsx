import { createDataScriptProfileTransport } from "../../../packages/explorer-state/src/datascript-profile-transport.mjs";
import ExplorerApp from "../../explorer-main/src/App";
import {
  type ExplorerProfile,
  type ExplorerTransport,
} from "../../explorer-main/src/profile-api";

export default function App() {
  const createDataScriptTransport = (profile: ExplorerProfile): ExplorerTransport => (createDataScriptProfileTransport as any)({
    profile,
  });

  return (
    <ExplorerApp
      entry="datascript"
      createDataScriptTransport={createDataScriptTransport}
    />
  );
}
