import { For, Show, type JSX } from "solid-js";
import { useAppState } from "../state";
import type { ConsistencyMode } from "../types";
import { ButtonSpinner, DisclosureButton, ErrorBlock } from "./Common";

const consistencyModeOrder = [
  "minimize-latency",
  "at-least-as-fresh",
  "at-exact-snapshot",
  "fully-consistent",
] as const;

function localDateTimeValue(instant: string): string {
  if (!instant) return "";
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function instantValue(localDateTime: string): string {
  if (!localDateTime) return "";
  const date = new Date(localDateTime);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function basisInstant(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? instant : date.toISOString();
}

export function ConsistencyPanel(): JSX.Element {
  const app = useAppState();
  const bootstrap = () => app.bootstrapData();
  const ready = () => Boolean(bootstrap());
  const basis = () => bootstrap()?.meta.basis;
  const consistency = () => bootstrap()?.data.consistency;
  const supportedModes = () => new Set(consistency()?.supported ?? []);
  const exactDateSupported = () =>
    Boolean(consistency()?.atExactSnapshotDateSelection);
  const exactDateValue = () => basis()?.capturedAt ?? "";
  const expansionKey = "segment:read-basis";
  const expanded = () => app.isExpanded(expansionKey);

  return (
    <section class="schema-shell consistency-shell" aria-labelledby="read-basis-title">
      <div
        class={`panel-card consistency-panel ${
          expanded() ? "" : "panel-card--collapsed"
        }`}
      >
        <div class="panel-heading consistency-panel__heading">
          <h2 id="read-basis-title" class="consistency-panel__title">
            <DisclosureButton
              expanded={expanded()}
              controls="read-basis-content"
              onClick={() => app.toggleExpanded(expansionKey)}
            >
              <span class="group-card__title">Consistency Semantics</span>
            </DisclosureButton>
          </h2>
          <div class="consistency-panel__actions">
            <button
              class="snapshot-refresh"
              type="button"
              disabled={!ready() || app.snapshotRefreshing()}
              onClick={app.requery}
            >
              Re-query
            </button>

            <button
              class="snapshot-refresh"
              type="button"
              disabled={!ready() || app.snapshotRefreshing()}
              aria-busy={app.snapshotRefreshing()}
              onClick={() => void app.refreshSnapshot().catch(() => undefined)}
            >
              <Show when={app.snapshotRefreshing()}>
                <ButtonSpinner />
              </Show>
              {app.snapshotRefreshing() ? "Refreshing…" : "Refresh Snapshot"}
            </button>
          </div>
        </div>

        <Show when={expanded()}>
          <div id="read-basis-content" class="consistency-panel__content">
            <div class="consistency-selection-row">
              <fieldset class="consistency-selection" aria-label="Consistency semantics" disabled={!ready()}>
                <div class="consistency-selection__options">
                  <For each={consistencyModeOrder}>
                    {(mode) => {
                      const disabled = () =>
                        !supportedModes().has(mode as ConsistencyMode);
                      const title = () =>
                        mode === "fully-consistent" && disabled()
                          ? `${mode}: ${consistency()?.fullyConsistentReason ?? "Unavailable in this deployment."}`
                          : mode;
                      return (
                        <label
                          class={`consistency-radio ${disabled()
                            ? "consistency-radio--disabled"
                            : ""}`}
                          title={title()}
                        >
                          <input
                            type="radio"
                            name="consistency-semantics"
                            value={mode}
                            checked={app.consistencyMode() === mode}
                            disabled={disabled()}
                            onChange={() =>
                              app.setConsistencyMode(mode as ConsistencyMode)
                            }
                          />
                          <span>{mode}{mode === "fully-consistent" && disabled() ? "*" : ""}</span>
                        </label>
                      );
                    }}
                  </For>
                </div>
              </fieldset>

              <Show when={basis()}>
                {(selected) => (
                  <span class="selected-basis" aria-label="Current selected basis">
                    <span aria-hidden="true">@</span>{" "}
                    <time dateTime={selected().capturedAt}>
                      {basisInstant(selected().capturedAt)}
                    </time>{" "}
                    <span>(revision {selected().revision})</span>
                  </span>
                )}
              </Show>
            </div>

            <Show when={!supportedModes().has("fully-consistent")}>
              <p class="basis-info__note">
                * {consistency()?.fullyConsistentReason}
              </p>
            </Show>

            <div class="consistency-panel__controls">
              <Show when={app.consistencyMode() === "at-least-as-fresh"}>
                <label class="page-size-control freshness-control">
                  <span class="page-size-control__label">at-least-as-fresh-as</span>
                  <input
                    class="freshness-control__input"
                    type="datetime-local"
                    step="1"
                    aria-label="at-least-as-fresh-as date"
                    value={localDateTimeValue(app.atLeastAsFreshAs())}
                    onChange={(event) =>
                      app.setAtLeastAsFreshAs(
                        instantValue(event.currentTarget.value),
                      )
                    }
                  />
                </label>
              </Show>

              <Show when={app.consistencyMode() === "at-exact-snapshot"}>
                <div class="exact-date-control">
                  <label class="page-size-control freshness-control">
                    <span class="page-size-control__label">at-exact-snapshot</span>
                    <input
                      class="freshness-control__input"
                      type="datetime-local"
                      step="1"
                      aria-label="at-exact-snapshot date"
                      aria-describedby="exact-date-selection-reason"
                      disabled={!exactDateSupported()}
                      value={localDateTimeValue(exactDateValue())}
                    />
                  </label>
                  <Show when={!exactDateSupported()}>
                    <p id="exact-date-selection-reason" class="basis-info__note">
                      {consistency()?.atExactSnapshotDateSelectionReason}
                    </p>
                  </Show>
                </div>
              </Show>
            </div>

            <Show when={app.snapshotError()}>
              {(error) => (
                <ErrorBlock label="Snapshot refresh failed" error={error()} />
              )}
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
