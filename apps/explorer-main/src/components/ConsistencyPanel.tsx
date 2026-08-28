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
  const fullyConsistentLimitation = () =>
    consistency()?.fullyConsistentReason?.trim() ?? "";
  const exactDateSupported = () =>
    Boolean(consistency()?.atExactSnapshotDateSelection);
  const setExactDate = (value: string) => {
    if (!value) {
      app.setAtExactSnapshotAt("");
      return;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      app.setAtExactSnapshotAt(date.toISOString());
    }
  };
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
                        mode === "fully-consistent" && disabled() && fullyConsistentLimitation()
                          ? `${mode}: ${fullyConsistentLimitation()}`
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
                          <span>{mode}{mode === "fully-consistent" && disabled() && fullyConsistentLimitation() ? "*" : ""}</span>
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

            <Show when={!supportedModes().has("fully-consistent") && fullyConsistentLimitation()}>
              <p class="basis-info__note basis-info__note--consistency">
                * {fullyConsistentLimitation()}
              </p>
            </Show>

            <div class="consistency-panel__controls">
              <Show when={app.consistencyMode() === "at-least-as-fresh"}>
                <div class="freshness-floor-control">
                  <fieldset class="freshness-floor-control__modes">
                    <legend class="page-size-control__label">
                      at-least-as-fresh-as
                    </legend>
                    <div class="freshness-floor-control__options">
                      <label class="consistency-radio">
                        <input
                          type="radio"
                          name="freshness-floor-mode"
                          value="relative"
                          checked={app.freshnessFloorMode() === "relative"}
                          onChange={() => app.setFreshnessFloorMode("relative")}
                        />
                        <span>Seconds ago</span>
                      </label>
                      <label class="consistency-radio">
                        <input
                          type="radio"
                          name="freshness-floor-mode"
                          value="absolute"
                          checked={app.freshnessFloorMode() === "absolute"}
                          onChange={() => app.setFreshnessFloorMode("absolute")}
                        />
                        <span>Absolute datetime</span>
                      </label>
                    </div>
                  </fieldset>

                  <Show when={app.freshnessFloorMode() === "relative"}>
                    <label class="page-size-control freshness-control">
                      <span class="page-size-control__label">seconds ago</span>
                      <input
                        class="freshness-control__input freshness-control__input--seconds"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label="at-least seconds ago"
                        aria-describedby="at-least-relative-selection-reason"
                        value={app.atLeastSecondsAgo()}
                        onInput={(event) =>
                          app.setAtLeastSecondsAgo(
                            Number(event.currentTarget.value),
                          )
                        }
                      />
                    </label>
                    <p id="at-least-relative-selection-reason" class="basis-info__note">
                      “Now” is the current selected snapshot date. Refresh Snapshot
                      moves this relative floor to the latest selected snapshot.
                    </p>
                  </Show>

                  <Show when={app.freshnessFloorMode() === "absolute"}>
                    <label class="page-size-control freshness-control">
                      <span class="page-size-control__label">absolute datetime</span>
                      <input
                        class="freshness-control__input"
                        type="datetime-local"
                        step="1"
                        aria-label="at-least-as-fresh-as date"
                        aria-describedby="at-least-absolute-selection-reason"
                        value={localDateTimeValue(app.atLeastAsFreshAs())}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          if (!value) {
                            app.setAtLeastAsFreshAs("");
                            return;
                          }
                          const date = new Date(value);
                          if (!Number.isNaN(date.getTime())) {
                            app.setAtLeastAsFreshAs(date.toISOString());
                          }
                        }}
                      />
                    </label>
                    <p id="at-least-absolute-selection-reason" class="basis-info__note">
                      Refresh Snapshot resets this floor to the latest selected
                      snapshot date.
                    </p>
                  </Show>
                </div>
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
                      value={localDateTimeValue(app.atExactSnapshotAt())}
                      onInput={(event) => setExactDate(event.currentTarget.value)}
                      onChange={(event) => setExactDate(event.currentTarget.value)}
                    />
                  </label>
                  <Show when={!exactDateSupported()}>
                    <p id="exact-date-selection-reason" class="basis-info__note">
                      {consistency()?.atExactSnapshotDateSelectionReason}
                    </p>
                  </Show>
                  <Show when={exactDateSupported()}>
                    <p id="exact-date-selection-reason" class="basis-info__note">
                      Selects the latest available immutable snapshot at or before
                      this datetime.
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
