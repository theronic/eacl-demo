import { createSignal } from "solid-js";

import errorCodesSchema from "../../../schemas/error-codes.v1.schema.json";
import explorerSchema from "../../../schemas/explorer.v1.schema.json";
import responseSchema from "../../../schemas/explorer-response.v1.schema.json";
import workerEventSchema from "../../../schemas/explorer-worker-event.v1.schema.json";
import availabilityData from "../../../registry/profile-registry.v1.json";
import profileData from "../../../packages/contracts/profiles.v1.json";
import { createRuntimeBoundaryValidator } from "../../../packages/contracts/src/runtime-validation.mjs";
import { createDataScriptProfileTransport } from "../../../packages/explorer-state/src/datascript-profile-transport.mjs";
import ExplorerApp from "../../explorer-main/src/App";
import {
  type ExplorerProfile,
  type ExplorerTransport,
} from "../../explorer-main/src/profile-api";

const validateWorkerEvent = createRuntimeBoundaryValidator(
  { errorCodesSchema, explorerSchema, responseSchema, workerEventSchema },
  "https://demo.eacl.dev/schemas/explorer-worker-event.v1.schema.json",
  "workerEvent"
);

export default function App() {
  const [workerProgress, setWorkerProgress] = createSignal<string | null>(null);
  const createDataScriptTransport = (profile: ExplorerProfile): ExplorerTransport => (createDataScriptProfileTransport as any)({
    profile,
    baseUrl: window.location.href,
    profileDefinitions: profileData,
    baseRegistry: availabilityData,
    validateEvent: validateWorkerEvent,
    onProgress: (event: { message: string; completed: number; total: number }) => setWorkerProgress(`${event.message} ${event.completed.toLocaleString()}/${event.total.toLocaleString()}`)
  });

  return (
    <ExplorerApp
      entry="datascript"
      createDataScriptTransport={createDataScriptTransport}
      startupMessage={workerProgress}
    />
  );
}
