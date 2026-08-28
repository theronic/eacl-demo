import { For, type JSX } from "solid-js";

export interface BackendOption {
  id: string;
  label: string;
}

export interface StorageOption {
  id: string;
  label: string;
  selectable: boolean;
  reason?: string | null;
}

export interface PlatformOption {
  id: string;
  label: string;
  selectable: boolean;
  reason?: string | null;
}

export function ProfileSelector(props: {
  backends: BackendOption[];
  backend: string;
  storage: string;
  storages: StorageOption[];
  platform: string;
  platforms: PlatformOption[];
  onBackend: (backend: string) => void;
  onStorage: (storage: string) => void;
  onPlatform: (platform: string) => void;
}): JSX.Element {
  return (
    <section class="schema-shell consistency-shell" aria-labelledby="profile-selector-title">
      <div class="panel-card consistency-panel">
        <div class="panel-heading consistency-panel__heading">
          <h2 id="profile-selector-title" class="consistency-panel__title">
            <span class="group-card__title">Backend &amp; Storage</span>
          </h2>
        </div>
        <div class="consistency-panel__content">
          <div class="consistency-selection-row">
            <fieldset class="consistency-selection">
              <legend class="consistency-selection__label">Backend:</legend>
              <div class="consistency-selection__options">
                <For each={props.backends}>
                  {(backend) => (
                    <label class="consistency-radio profile-selector__option">
                      <input
                        type="radio"
                        name="explorer-backend"
                        value={backend.id}
                        checked={props.backend === backend.id}
                        onChange={() => props.onBackend(backend.id)}
                      />
                      <span>{backend.label}</span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          </div>
          <div class="consistency-selection-row">
            <fieldset class="consistency-selection">
              <legend class="consistency-selection__label">Storage:</legend>
              <div class="consistency-selection__options">
                <For each={props.storages}>
                  {(storage) => (
                    <label
                      class={`consistency-radio profile-selector__option ${storage.selectable ? "" : "consistency-radio--disabled"}`}
                      title={storage.reason ?? storage.label}
                    >
                      <input
                        type="radio"
                        name="explorer-storage"
                        value={storage.id}
                        checked={props.storage === storage.id}
                        disabled={!storage.selectable}
                        onChange={() => props.onStorage(storage.id)}
                      />
                      <span>{storage.label}</span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          </div>
          <div class="consistency-selection-row">
            <fieldset class="consistency-selection">
              <legend class="consistency-selection__label">Platform:</legend>
              <div class="consistency-selection__options">
                <For each={props.platforms}>
                  {(platform) => (
                    <label
                      class={`consistency-radio profile-selector__option ${platform.selectable ? "" : "consistency-radio--disabled"}`}
                      title={platform.reason ?? platform.label}
                    >
                      <input
                        type="radio"
                        name="explorer-platform"
                        value={platform.id}
                        checked={props.platform === platform.id}
                        disabled={!platform.selectable}
                        onChange={() => props.onPlatform(platform.id)}
                      />
                      <span>{platform.label}</span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          </div>
        </div>
      </div>
    </section>
  );
}
