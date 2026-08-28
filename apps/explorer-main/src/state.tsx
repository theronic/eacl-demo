import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
  type Resource,
} from "solid-js";
import { LatestRequest } from "./api";
import { readPreferences, writePreferences } from "./preferences";
import type {
  ApiSuccess,
  Bootstrap,
  ConsistencyMode,
  ConsistencyRequest,
  EaclObject,
  FreshnessFloorMode,
  PageSize,
  ReaderHealth,
  SeedProgress,
  Theme,
} from "./types";

interface AppStateValue {
  health: Resource<ApiSuccess<ReaderHealth>>;
  healthElapsedMs: Accessor<number>;
  refetchHealth: () => void;
  bootstrap: Resource<ApiSuccess<Bootstrap>>;
  bootstrapData: Accessor<ApiSuccess<Bootstrap> | undefined>;
  activeQueryBasis: Accessor<string>;
  refetchBootstrap: () => void;
  runQuery: <T>(
    request: LatestRequest,
    path: string,
    options?: RequestInit,
  ) => Promise<ApiSuccess<T>>;
  requery: () => void;
  subjectId: Accessor<string>;
  setSubjectId: (value: string) => void;
  permission: Accessor<string>;
  setPermission: (value: string) => void;
  selectedResource: Accessor<EaclObject | undefined>;
  setSelectedResource: (value: EaclObject | undefined) => void;
  knownSubjects: Accessor<readonly EaclObject[]>;
  rememberSubjects: (values: readonly EaclObject[]) => void;
  knownResources: Accessor<readonly EaclObject[]>;
  rememberResources: (values: readonly EaclObject[]) => void;
  pageSize: Accessor<PageSize>;
  setPageSize: (value: PageSize) => void;
  cacheEnabled: Accessor<boolean>;
  setCacheEnabled: (value: boolean) => void;
  populateCache: Accessor<boolean>;
  setPopulateCache: (value: boolean) => void;
  consistencyMode: Accessor<ConsistencyMode>;
  consistency: Accessor<ConsistencyRequest>;
  setConsistencyMode: (value: ConsistencyMode) => void;
  atLeastAsFreshAs: Accessor<string>;
  setAtLeastAsFreshAs: (value: string) => void;
  freshnessFloorMode: Accessor<FreshnessFloorMode>;
  setFreshnessFloorMode: (value: FreshnessFloorMode) => void;
  atLeastSecondsAgo: Accessor<number>;
  setAtLeastSecondsAgo: (value: number) => void;
  atExactSnapshotAt: Accessor<string>;
  setAtExactSnapshotAt: (value: string) => void;
  refreshSnapshot: () => Promise<void>;
  snapshotRefreshing: Accessor<boolean>;
  snapshotError: Accessor<unknown>;
  theme: Accessor<Theme>;
  setTheme: (value: Theme) => void;
  mutationRevision: Accessor<string>;
  applyMutationRevision: (value: string) => void;
  queryGeneration: Accessor<number>;
  basisGeneration: Accessor<number>;
  seedProgress: Accessor<SeedProgress | undefined>;
  setSeedProgress: (value: SeedProgress | undefined) => void;
  retrySeedPoll: () => void;
  seeding: Accessor<boolean>;
  expanded: Accessor<ReadonlySet<string>>;
  toggleExpanded: (key: string) => void;
  isExpanded: (key: string) => boolean;
}

const AppState = createContext<AppStateValue>();

export const AppStateProvider: ParentComponent = (props) => {
  const preferences = readPreferences();
  const healthRequest = new LatestRequest();
  const bootstrapRequest = new LatestRequest();
  const snapshotRefreshRequest = new LatestRequest();
  const seedPollRequest = new LatestRequest();
  const [healthElapsedMs, setHealthElapsedMs] = createSignal(0);
  let healthTimer: number | undefined;
  const probeHealth = async () => {
    const started = performance.now();
    setHealthElapsedMs(0);
    if (healthTimer !== undefined) window.clearInterval(healthTimer);
    healthTimer = window.setInterval(
      () => setHealthElapsedMs(performance.now() - started),
      100,
    );
    try {
      return await healthRequest.run<ReaderHealth>("/health");
    } finally {
      if (healthTimer !== undefined) window.clearInterval(healthTimer);
      healthTimer = undefined;
      setHealthElapsedMs(performance.now() - started);
    }
  };
  const [health, { refetch: refetchHealthResource }] = createResource(
    () => true,
    probeHealth,
  );
  const healthReady = createMemo(() => {
    if (health.loading || health.error) return false;
    const envelope = health();
    return envelope?.data.status === "ready" ? envelope.meta.requestId : false;
  });
  const [bootstrap, { refetch: refetchBootstrapResource }] = createResource(
    healthReady,
    () => bootstrapRequest.run<Bootstrap>("/bootstrap"),
  );
  const [bootstrapData, setBootstrapData] = createSignal<ApiSuccess<Bootstrap>>();
  const activeQueryBasis = createMemo(() => {
    const envelope = bootstrapData();
    return envelope?.meta.basis?.id ?? envelope?.meta.revision ?? "pending";
  });
  const [subjectId, setSubjectSignal] = createSignal(preferences.subjectId);
  const [permission, setPermissionSignal] = createSignal(preferences.permission);
  const [selectedResource, setSelectedResource] = createSignal<EaclObject>();
  const [knownSubjects, setKnownSubjects] = createSignal<readonly EaclObject[]>([]);
  const [knownResources, setKnownResources] = createSignal<readonly EaclObject[]>([]);
  const [pageSize, setPageSizeSignal] = createSignal<PageSize>(preferences.pageSize);
  const [cacheEnabled, setCacheSignal] = createSignal(preferences.cacheEnabled);
  const [populateCache, setPopulateCacheSignal] = createSignal(
    preferences.populateCache,
  );
  const [consistencyMode, setConsistencySignal] =
    createSignal<ConsistencyMode>("minimize-latency");
  const [freshnessFloorMode, setFreshnessFloorModeSignal] =
    createSignal<FreshnessFloorMode>("relative");
  const [atLeastSecondsAgo, setAtLeastSecondsAgoSignal] = createSignal(60);
  const [absoluteFreshnessAt, setAbsoluteFreshnessAt] = createSignal("");
  const [atExactSnapshotAt, setAtExactSnapshotAtSignal] = createSignal("");
  const selectedSnapshotCapturedAt = createMemo(
    () => bootstrapData()?.meta.basis?.capturedAt ?? "",
  );
  const atLeastAsFreshAs = createMemo(() => {
    if (freshnessFloorMode() === "absolute") return absoluteFreshnessAt();
    const selectedAt = selectedSnapshotCapturedAt();
    const selectedTime = Date.parse(selectedAt);
    if (!Number.isFinite(selectedTime)) return "";
    const seconds = Math.max(0, Math.floor(atLeastSecondsAgo()));
    return new Date(selectedTime - seconds * 1_000).toISOString();
  });
  const consistency = createMemo<ConsistencyRequest>(() => ({
    mode: consistencyMode(),
    ...(consistencyMode() === "at-least-as-fresh" && atLeastAsFreshAs()
      ? {
          atLeastAsFreshAs: atLeastAsFreshAs(),
          ...(activeQueryBasis() === "pending"
            ? {}
            : {
                atLeastAsFreshBasisId: activeQueryBasis(),
                ...(selectedSnapshotCapturedAt()
                  ? {
                      atLeastAsFreshBasisCapturedAt:
                        selectedSnapshotCapturedAt(),
                    }
                  : {}),
              }),
        }
      : {}),
    ...(consistencyMode() === "at-exact-snapshot" && atExactSnapshotAt()
      ? { atExactSnapshotAt: atExactSnapshotAt() }
      : {}),
  }));
  const [snapshotRefreshing, setSnapshotRefreshing] = createSignal(false);
  const [snapshotError, setSnapshotError] = createSignal<unknown>();
  const [theme, setTheme] = createSignal<Theme>(preferences.theme);
  const [mutationRevision, setMutationRevision] = createSignal("");
  const [queryGeneration, setQueryGeneration] = createSignal(0);
  const [basisGeneration, setBasisGeneration] = createSignal(0);
  const [seedProgress, setSeedProgress] = createSignal<SeedProgress>();
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(
    new Set(preferences.expanded),
  );
  const seeding = createMemo(() => seedProgress()?.status === "seeding");
  const retrySeedPoll = () => {
    const current = seedProgress();
    if (!current || current.status !== "error") return;
    setSeedProgress({
      ...current,
      status: "seeding",
      error: null,
      label: "Reconnecting to seed status",
    });
  };

  const runQuery = async <T,>(
    request: LatestRequest,
    path: string,
    options: RequestInit = {},
  ): Promise<ApiSuccess<T>> => request.run<T>(path, options);
  const requery = () => setQueryGeneration((value) => value + 1);
  const rerunBasisQueries = () => setBasisGeneration((value) => value + 1);
  const setSubjectId = (value: string) => {
    if (value !== subjectId()) setSelectedResource(undefined);
    setSubjectSignal(value);
  };
  const setPermission = (value: string) => {
    if (value !== permission()) setSelectedResource(undefined);
    setPermissionSignal(value);
  };
  const setPageSize = (value: PageSize) => {
    setPageSizeSignal(value);
  };
  const setCacheEnabled = (value: boolean) => {
    setCacheSignal(value);
  };
  const setPopulateCache = (value: boolean) => {
    setPopulateCacheSignal(value);
  };
  const setConsistencyMode = (value: ConsistencyMode) => {
    if (value === consistencyMode()) return;
    setConsistencySignal(value);
  };
  const setAtLeastAsFreshAs = (value: string) => {
    if (value === absoluteFreshnessAt()) return;
    setAbsoluteFreshnessAt(value);
  };
  const setFreshnessFloorMode = (value: FreshnessFloorMode) => {
    if (value === freshnessFloorMode()) return;
    setFreshnessFloorModeSignal(value);
  };
  const setAtLeastSecondsAgo = (value: number) => {
    const normalized = Math.max(0, Math.floor(value));
    if (!Number.isFinite(normalized) || normalized === atLeastSecondsAgo()) return;
    setAtLeastSecondsAgoSignal(normalized);
  };
  const setAtExactSnapshotAt = (value: string) => {
    if (value === atExactSnapshotAt()) return;
    setAtExactSnapshotAtSignal(value);
  };
  const remember = (
    setter: (updater: (current: readonly EaclObject[]) => readonly EaclObject[]) => void,
    values: readonly EaclObject[],
  ) => setter((current) => {
    const byKey = new Map(current.map((value) => [`${value.type}\u0000${value.id}`, value]));
    for (const value of values) byKey.set(`${value.type}\u0000${value.id}`, value);
    return [...byKey.values()].sort((left, right) =>
      `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
  });
  const rememberSubjects = (values: readonly EaclObject[]) =>
    remember(setKnownSubjects, values);
  const rememberResources = (values: readonly EaclObject[]) =>
    remember(setKnownResources, values);
  const selectResource = (value: EaclObject | undefined) => {
    if (value) rememberResources([value]);
    setSelectedResource(value);
  };
  const applyMutationRevision = (value: string) => {
    setMutationRevision(value);
  };
  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const installBootstrap = (envelope: ApiSuccess<Bootstrap>, refreshed: boolean) => {
    const previous = bootstrapData();
    const previousBasis = previous?.meta.basis?.id ?? previous?.meta.revision;
    const nextBasis = envelope.meta.basis?.id ?? envelope.meta.revision;
    const replaceQueries = refreshed || Boolean(previous && previousBasis !== nextBasis);
    batch(() => {
      setBootstrapData(envelope);
      setMutationRevision(envelope.meta.revision);
      setSeedProgress(envelope.data.seed);
      if ((refreshed || !absoluteFreshnessAt()) && envelope.meta.basis?.capturedAt) {
        setAbsoluteFreshnessAt(envelope.meta.basis.capturedAt);
      }
      if ((refreshed || !atExactSnapshotAt()) && envelope.meta.basis?.capturedAt) {
        setAtExactSnapshotAtSignal(envelope.meta.basis.capturedAt);
      }
      rememberSubjects(envelope.data.quickSubjects.map(({ id }) => ({ type: "user", id })));
      const permissions = Object.values(
        envelope.data.schema.permissionsByType,
      ).flat();
      if (!permissions.includes(permission())) {
        setPermissionSignal(permissions[0] ?? "");
      }
      if (!envelope.data.consistency.supported.includes(consistencyMode())) {
        setConsistencySignal(envelope.data.consistency.default);
      }
      if (replaceQueries) {
        rerunBasisQueries();
      }
    });
  };

  const refreshSnapshot = async () => {
    setSnapshotError(undefined);
    setSnapshotRefreshing(true);
    try {
      const envelope = await snapshotRefreshRequest.run<Bootstrap>(
        "/refresh-snapshot",
        { method: "POST" },
      );
      installBootstrap(envelope, true);
    } catch (error) {
      setSnapshotError(error);
      throw error;
    } finally {
      setSnapshotRefreshing(false);
    }
  };

  createEffect(
    on(
      // Reading a failed Solid resource accessor rethrows its error, and a
      // refreshing resource retains its previous value. Observe state first
      // so neither failure nor stale bootstrap data escapes into application
      // synchronization.
      () => (bootstrap.loading || bootstrap.error ? undefined : bootstrap()),
      (envelope) => {
        if (!envelope) return;
        installBootstrap(envelope, false);
      },
    ),
  );

  createEffect(
    on(
      () => [
        subjectId(),
        permission(),
        pageSize(),
        cacheEnabled(),
        populateCache(),
        theme(),
        [...expanded()].sort().join("\u0000"),
      ] as const,
      () =>
        writePreferences({
          subjectId: subjectId(),
          permission: permission(),
          pageSize: pageSize(),
          cacheEnabled: cacheEnabled(),
          populateCache: populateCache(),
          theme: theme(),
          expanded: [...expanded()].sort(),
        }),
    ),
  );

  createEffect(() => {
    document.documentElement.dataset.theme = theme();
  });

  createEffect(() => {
    if (!seeding()) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await seedPollRequest.run<SeedProgress>("/seed");
        if (!active) return;
        setSeedProgress(result.data);
        if (result.data.status === "seeding") {
          // Each Datahike transaction advances the database revision. Keep
          // already-open EACL pages pinned while the batch is moving instead
          // of aborting and restarting them on every progress poll.
          timer = window.setTimeout(poll, 1000);
        } else {
          if (result.meta.revision !== mutationRevision()) {
            applyMutationRevision(result.meta.revision);
          }
          await refreshSnapshot();
        }
      } catch (error) {
        if (!active) return;
        const current = seedProgress();
        setSeedProgress({
          status: "error",
          serversAdded: current?.serversAdded ?? 0,
          serversCompleted: current?.serversCompleted ?? 0,
          serversTarget: current?.serversTarget ?? 0,
          totalServers: current?.totalServers ?? 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    timer = window.setTimeout(poll, 100);
    onCleanup(() => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      seedPollRequest.abort();
    });
  });

  onCleanup(() => {
    if (healthTimer !== undefined) window.clearInterval(healthTimer);
    healthRequest.abort();
    bootstrapRequest.abort();
    snapshotRefreshRequest.abort();
    seedPollRequest.abort();
  });

  const value: AppStateValue = {
    health,
    healthElapsedMs,
    refetchHealth: () => void refetchHealthResource(),
    bootstrap,
    bootstrapData,
    activeQueryBasis,
    refetchBootstrap: () => void refetchBootstrapResource(),
    runQuery,
    requery,
    subjectId,
    setSubjectId,
    permission,
    setPermission,
    selectedResource,
    setSelectedResource: selectResource,
    knownSubjects,
    rememberSubjects,
    knownResources,
    rememberResources,
    pageSize,
    setPageSize,
    cacheEnabled,
    setCacheEnabled,
    populateCache,
    setPopulateCache,
    consistencyMode,
    consistency,
    setConsistencyMode,
    atLeastAsFreshAs,
    setAtLeastAsFreshAs,
    freshnessFloorMode,
    setFreshnessFloorMode,
    atLeastSecondsAgo,
    setAtLeastSecondsAgo,
    atExactSnapshotAt,
    setAtExactSnapshotAt,
    refreshSnapshot,
    snapshotRefreshing,
    snapshotError,
    theme,
    setTheme,
    mutationRevision,
    applyMutationRevision,
    queryGeneration,
    basisGeneration,
    seedProgress,
    setSeedProgress,
    retrySeedPoll,
    seeding,
    expanded,
    toggleExpanded,
    isExpanded: (key) => expanded().has(key),
  };

  return <AppState.Provider value={value}>{props.children}</AppState.Provider>;
};

export function useAppState(): AppStateValue {
  const value = useContext(AppState);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}
