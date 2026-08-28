import { For, type JSX } from "solid-js";
import type { DeploymentIdentityWarning } from "../types";

const FIELD_LABELS: Record<string, string> = {
  demoSha: "Demo Git SHA",
  eaclSha: "EACL Git SHA",
  artifactSha256: "Artifact SHA-256",
  deploymentId: "Deployment ID",
  dataManifestSha256: "Data manifest SHA-256",
};

export function DeploymentWarning(props: {
  backendLabel: string;
  warning: DeploymentIdentityWarning;
}): JSX.Element {
  return (
    <section class="deployment-warning" role="status" aria-live="polite">
      <div class="deployment-warning__copy">
        <strong>{props.backendLabel} service version warning</strong>
        <p>
          {props.warning.message} Queries remain available because the service's
          health and bootstrap identities agree.
        </p>
      </div>
      <dl class="deployment-warning__details">
        <For each={props.warning.differences}>
          {(difference) => (
            <div class="deployment-warning__difference">
              <dt>{FIELD_LABELS[difference.field] ?? difference.field}</dt>
              <dd>
                <span>Registry</span>
                <code>{difference.expected}</code>
              </dd>
              <dd>
                <span>Service</span>
                <code>{difference.actual}</code>
              </dd>
            </div>
          )}
        </For>
      </dl>
    </section>
  );
}
