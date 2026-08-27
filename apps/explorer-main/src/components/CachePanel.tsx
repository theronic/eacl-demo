import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { LatestRequest } from "../api";
import { useAppState } from "../state";
import type { CacheSnapshot } from "../types";
import {
  ButtonSpinner,
  DisclosureButton,
  ErrorBlock,
  InlineError,
  InlineLoading,
  LoadingBlock,
} from "./Common";

interface CapturedSnapshot {
  capturedAt: string;
  cacheEnabled: boolean;
  snapshot: CacheSnapshot;
}
export function CachePanel(): JSX.Element {
  const app = useAppState();
  const refreshRequest = new LatestRequest();
  const evictRequest = new LatestRequest();
  const expansionKey = "segment:cache";
  const expanded = () => app.isExpanded(expansionKey);
  const [snapshot, setSnapshot] = createSignal<CapturedSnapshot>();
  const [refreshing, setRefreshing] = createSignal(false);
  const [refreshError, setRefreshError] = createSignal<unknown>();
  const [capturedOnFirstOpen, setCapturedOnFirstOpen] = createSignal(false);
  const [evicting, setEvicting] = createSignal(false);
  const [evictError, setEvictError] = createSignal<unknown>();

  const refreshCache = async () => {
    setRefreshing(true);
    setRefreshError(undefined);
    setEvictError(undefined);
    try {
      const result = await refreshRequest.run<CacheSnapshot>("/api/cache");
      setSnapshot({
        capturedAt: result.data.capturedAt,
        cacheEnabled: app.cacheEnabled(),
        snapshot: result.data,
      });
    } catch (error) {
      setRefreshError(error);
    } finally {
      setRefreshing(false);
    }
  };

  const evictCache = async () => {
    setEvicting(true);
    setEvictError(undefined);
    setRefreshError(undefined);
    try {
      const result = await evictRequest.run<{ status: string }>("/api/cache/evict", {
        method: "POST",
        body: "{}",
      });
      setSnapshot(undefined);
      app.applyMutationRevision(result.meta.revision);
      app.requery();
    } catch (error) {
      setEvictError(error);
    } finally {
      setEvicting(false);
    }
  };

  createEffect(() => {
    if (!expanded() || capturedOnFirstOpen()) return;
    setCapturedOnFirstOpen(true);
    void refreshCache();
  });

  onCleanup(() => {
    refreshRequest.abort();
    evictRequest.abort();
  });

  const prettySnapshot = () => JSON.stringify(snapshot(), null, 2);

  return (
    <section class="schema-shell cache-shell">
      <div class={`panel-card cache-panel ${expanded() ? "" : "panel-card--collapsed"}`}>
        <div class="panel-heading schema-shell__header">
          <DisclosureButton
            expanded={expanded()}
            controls="cache-segment-content"
            onClick={() => app.toggleExpanded(expansionKey)}
          >
            <span class="group-card__title">Cache</span>
          </DisclosureButton>
          <div class="cache-controls">
            <Show when={!expanded() && refreshing()}>
              <InlineLoading label="Loading cache metrics" />
            </Show>
            <Show when={!expanded() && evicting()}>
              <InlineLoading label="Evicting cache" />
            </Show>
            <Show when={!expanded() && refreshError()}>
              <InlineError label="Cache refresh failed" />
            </Show>
            <Show when={!expanded() && evictError()}>
              <InlineError label="Cache eviction failed" />
            </Show>
            <label class="cache-toggle">
              <span class="cache-toggle__label">Cache Enabled:</span>
              <span class="cache-switch">
                <input
                  class="cache-switch__input"
                  type="checkbox"
                  role="switch"
                  disabled={refreshing() || evicting()}
                  checked={app.cacheEnabled()}
                  aria-checked={app.cacheEnabled()}
                  onChange={(event) => app.setCacheEnabled(event.currentTarget.checked)}
                />
                <span class="cache-switch__slider" aria-hidden="true" />
              </span>
              <span class="cache-toggle__state">{app.cacheEnabled() ? "On" : "Off"}</span>
            </label>
            <label class="cache-toggle">
              <span class="cache-toggle__label">Populate Cache?</span>
              <span class="cache-switch">
                <input
                  class="cache-switch__input"
                  type="checkbox"
                  role="switch"
                  disabled={refreshing() || evicting()}
                  checked={app.populateCache()}
                  aria-checked={app.populateCache()}
                  onChange={(event) => app.setPopulateCache(event.currentTarget.checked)}
                />
                <span class="cache-switch__slider" aria-hidden="true" />
              </span>
              <span class="cache-toggle__state">{app.populateCache() ? "On" : "Off"}</span>
            </label>
            <Show when={app.bootstrapData()?.data.capabilities.cacheEvict}>
              <button
                type="button"
                class="pagination-button cache-evict"
                disabled={evicting() || refreshing()}
                aria-busy={evicting()}
                onClick={() => void evictCache()}
              >
                <Show when={evicting()}>
                  <ButtonSpinner />
                </Show>
                Evict Cache
              </button>
            </Show>
            <button
              type="button"
              class="pagination-button cache-refresh"
              disabled={refreshing() || evicting()}
              aria-busy={refreshing()}
              onClick={() => void refreshCache()}
            >
              <Show when={refreshing()}>
                <ButtonSpinner />
              </Show>
              Refresh cache
            </button>
          </div>
        </div>
        <Show when={expanded()}>
          <div id="cache-segment-content" class="cache-metrics">
            <Show when={evicting() && !snapshot()}>
              <LoadingBlock label="cache eviction" />
            </Show>
            <Show when={refreshing() && !snapshot()}>
              <LoadingBlock label="cache metrics" />
            </Show>
            <Show when={evictError()}>
              {(error) => (
                <ErrorBlock
                  label="Cache eviction failed"
                  error={error()}
                  retry={() => void evictCache()}
                />
              )}
            </Show>
            <Show when={refreshError()}>
              {(error) => (
                <ErrorBlock
                  label="Cache refresh failed"
                  error={error()}
                  retry={() => void refreshCache()}
                />
              )}
            </Show>
            <Show
              when={snapshot()}
              fallback={
                <Show when={!evicting() && !refreshing() && !evictError() && !refreshError()}>
                  <p class="empty-state">
                    Cache metrics have not been captured. Click Refresh cache.
                  </p>
                </Show>
              }
            >
              <div aria-busy={refreshing() || evicting()}>
                <p class="cache-snapshot-meta">
                  Captured {new Date(snapshot()!.capturedAt).toLocaleString()} · cache{" "}
                  {snapshot()!.cacheEnabled ? "enabled" : "disabled"}
                </p>
                <pre class="cache-metrics__code">
                  <code>{prettySnapshot()}</code>
                </pre>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
