# Architecture and Debugging Report

## Current Architecture
- **Framework**: React + Vite (Native Integration)
- **Visualization**: `<EmbeddingAtlas />` component (from `embedding-atlas/react` v0.15.0)
- **Data Engine**: DuckDB-WASM (via `@uwdata/mosaic-core`)
- **Data Source**: Local Parquet file (`dataset.parquet`)
- **Chat**: React State + Vercel Serverless Function (Planned)

**Note**: The previous "Hybrid Iframe" strategy (embedding a static HTML export) has been **discarded** in favor of this native integration, which allows for direct two-way communication between the Map and the Application (e.g. Selection Events).

---

## Issue: Labels "Generating..." Forever (Hang)

### Symptoms
- The native React component `<EmbeddingAtlas />` loads the map and points correctly.
- A status message "Generating labels..." appears in the bottom left but never resolves.
- Text labels never appear on the map in **Development Mode**.
- (Labels work correctly in **Production Build**).

### Root Cause
The `embedding-atlas` library uses Web Workers to perform density clustering and label generation. These workers utilize WASM binaries.
In Vite's default Development Mode, dependencies are pre-bundled (Optimized). This pre-bundling process:
1.  Can break the relative `import.meta.url` resolution used by the workers to find their WASM assets.
2.  Can transform ES Module workers into a format incompatible with dynamic WASM imports.

### The Fix

We aligned our `vite.config.ts` with the official `embedding-atlas` examples to correctly handle these assets.

#### 1. Enable ES Module Workers
We explicitly configured Vite to keep workers as ES modules.

```typescript
// vite.config.ts
worker: {
  format: "es", 
},
build: {
  target: "esnext",
}
```

#### 2. Exclude Libraries from Pre-Bundling
We forced Vite to **skip** pre-bundling for the Atlas-related packages. This enables the browser to load the raw files from `node_modules`, ensuring that relative paths (like `./clustering.wasm`) resolve correctly at runtime.

```typescript
// vite.config.ts
optimizeDeps: {
  exclude: [
    "embedding-atlas", 
    "@uwdata/mosaic-core", 
    "@duckdb/duckdb-wasm"
  ],
},
```

#### 3. Clean `index.html`
We removed manual overrides (`window.EMBEDDING_ATLAS_HOME`) that were interfering with the library's automatic path resolution.

### Result
- **Dev Mode**: Labels generate successfully.
- **Production Build**: Labels continue to work.
- **Selection Logic**: We fixed a column ID mismatch (`_row_index` vs `__row_index__`), enabling the "Select" feature to pass selected data points to the Chat application.
