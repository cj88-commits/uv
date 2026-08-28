import { describe, it, expect, vi } from "vitest";
import { syncUvLayer, type UvLayerMap, type UvFrameParams } from "./MapView";

type Coordinates = UvFrameParams["coordinates"];
type UpdateImageMock = ReturnType<typeof makeUpdateImageMock>;

function makeUpdateImageMock() {
  return vi.fn((_opts: { url: string; coordinates: Coordinates }) => {});
}

// A minimal in-memory fake of the maplibregl.Map surface syncUvLayer
// actually uses -- no real Map/WebGL context needed, so these tests are
// fast and deterministic regardless of network/tile-loading timing (the
// exact thing that made the real bug intermittent and hard to reproduce
// on demand in a real browser).
function createMockMap() {
  const sources = new Map<string, { updateImage: UpdateImageMock }>();
  const layers = new Set<string>();
  const addSourceCalls: { id: string; source: unknown }[] = [];
  const addLayerCalls: { layer: { id: string }; beforeId?: string }[] = [];

  const map: UvLayerMap = {
    getSource: (id) => sources.get(id),
    addSource: (id, source) => {
      addSourceCalls.push({ id, source });
      sources.set(id, { updateImage: makeUpdateImageMock() });
    },
    getLayer: (id) => (layers.has(id) ? {} : undefined),
    addLayer: (layer, beforeId) => {
      addLayerCalls.push({ layer, beforeId });
      layers.add(layer.id);
    },
  };

  return { map, sources, layers, addSourceCalls, addLayerCalls };
}

function frame(overrides: Partial<UvFrameParams> = {}): UvFrameParams {
  return {
    sourceId: "uv-field",
    layerId: "uv-field-layer",
    dataUrl: "data:image/png;base64,AAA",
    coordinates: [
      [-180, 85],
      [180, 85],
      [180, -85],
      [-180, -85],
    ],
    beforeLayerCandidate: "countries-boundary",
    ...overrides,
  };
}

describe("syncUvLayer: base behaviour", () => {
  it("adds both the source and the layer when neither exists", () => {
    const { map, addSourceCalls, addLayerCalls } = createMockMap();
    syncUvLayer(map, frame());
    expect(addSourceCalls).toHaveLength(1);
    expect(addLayerCalls).toHaveLength(1);
    expect(addLayerCalls[0].layer.id).toBe("uv-field-layer");
  });

  it("resolves beforeLayerCandidate to a real beforeId when that layer exists", () => {
    const { map, layers, addLayerCalls } = createMockMap();
    layers.add("countries-boundary"); // pretend the base style already added it
    syncUvLayer(map, frame());
    expect(addLayerCalls[0].beforeId).toBe("countries-boundary");
  });

  it("omits beforeId (rather than throwing) when the candidate layer doesn't exist", () => {
    const { map, addLayerCalls } = createMockMap();
    syncUvLayer(map, frame());
    expect(addLayerCalls[0].beforeId).toBeUndefined();
  });
});

describe("syncUvLayer: sequences A and B -- order independence", () => {
  // syncUvLayer is a synchronous reconciliation call, not an event
  // listener -- it has no notion of "which became ready first". The
  // property that actually matters (map-ready and data-ready can arrive in
  // either order and still converge) lives in MapView's mapReady React
  // state driving the effect's re-run, not in this function. What this
  // function must guarantee, regardless of when it's first called, is a
  // single call brings a from-scratch map fully into the correct state.
  it("a single call is sufficient to reach the fully-synced state, whichever 'side' was ready first", () => {
    const { map, sources, layers } = createMockMap();
    syncUvLayer(map, frame());
    expect(sources.has("uv-field")).toBe(true);
    expect(layers.has("uv-field-layer")).toBe(true);
  });
});

describe("syncUvLayer: sequence C -- restoring a missing source/layer", () => {
  it("re-adds the layer if only the layer is missing (source already exists)", () => {
    const { map, sources, layers, addSourceCalls, addLayerCalls } = createMockMap();
    // Simulate the source having survived (e.g. a style event) while the
    // layer did not -- exactly the "don't assume one implies the other"
    // case called out in the investigation.
    sources.set("uv-field", { updateImage: makeUpdateImageMock() });
    syncUvLayer(map, frame());
    expect(addSourceCalls).toHaveLength(0); // not re-added, only updated
    expect(addLayerCalls).toHaveLength(1);
    expect(layers.has("uv-field-layer")).toBe(true);
  });

  it("re-adds the source if only the source is missing (layer already exists)", () => {
    const { map, layers, addSourceCalls, addLayerCalls } = createMockMap();
    layers.add("uv-field-layer");
    syncUvLayer(map, frame());
    expect(addSourceCalls).toHaveLength(1);
    expect(addLayerCalls).toHaveLength(0); // not re-added, already present
  });

  it("does nothing extra when both already exist and match", () => {
    const { map, addSourceCalls, addLayerCalls } = createMockMap();
    syncUvLayer(map, frame());
    addSourceCalls.length = 0;
    addLayerCalls.length = 0;
    syncUvLayer(map, frame());
    expect(addSourceCalls).toHaveLength(0);
    expect(addLayerCalls).toHaveLength(0);
  });
});

describe("syncUvLayer: sequence D -- frame (time control) changes", () => {
  it("updates the existing source's image rather than creating a duplicate source/layer", () => {
    const { map, sources, layers, addSourceCalls, addLayerCalls } = createMockMap();
    syncUvLayer(map, frame({ dataUrl: "data:image/png;base64,NOW" }));
    syncUvLayer(map, frame({ dataUrl: "data:image/png;base64,PLUS1H" }));
    syncUvLayer(map, frame({ dataUrl: "data:image/png;base64,PLUS2H" }));

    expect(addSourceCalls).toHaveLength(1); // exactly one source, ever
    expect(addLayerCalls).toHaveLength(1); // exactly one layer, ever
    expect(sources.size).toBe(1);
    expect(layers.size).toBe(1);

    const updateImageMock = sources.get("uv-field")!.updateImage;
    // The first call creates the source (via addSource, not updateImage);
    // only the 2nd and 3rd calls -- the +1h and +2h frame changes -- hit
    // the "already exists" branch.
    expect(updateImageMock).toHaveBeenCalledTimes(2);
    expect(updateImageMock).toHaveBeenLastCalledWith({
      url: "data:image/png;base64,PLUS2H",
      coordinates: frame().coordinates,
    });
  });

  it("passes the new coordinates through on every update", () => {
    const { map, sources } = createMockMap();
    const coordsA = frame().coordinates;
    const coordsB: UvFrameParams["coordinates"] = [
      [-170, 80],
      [170, 80],
      [170, -80],
      [-170, -80],
    ];
    syncUvLayer(map, frame({ coordinates: coordsA }));
    syncUvLayer(map, frame({ coordinates: coordsB, dataUrl: "data:image/png;base64,B" }));
    expect(sources.get("uv-field")!.updateImage).toHaveBeenLastCalledWith({
      url: "data:image/png;base64,B",
      coordinates: coordsB,
    });
  });
});
