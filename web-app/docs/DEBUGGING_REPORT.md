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

---

## Issue: Labels Not Working with `npm link` (Local Development)

### Symptoms
When testing local modifications to `embedding-atlas` using `npm link`:
- Map renders correctly
- Highlight feature works (orange circles appear)
- Labels stuck at "Generating labels..." forever
- Console shows: `The request id "...\embedding-atlas\...\clustering.worker.js" is outside of Vite serving allow list`

### Root Cause
When using `npm link` to test a local version of `embedding-atlas`, the linked package files are located outside the web-app directory. Vite's default security settings (`server.fs.allow`) block serving files from outside the project root.

Additionally, the linked packages (`@embedding-atlas/viewer`, `@embedding-atlas/component`, etc.) need to be excluded from Vite's pre-bundling optimization.

### The Fix

#### 1. Allow Vite to Serve Files from Linked Package Directory

```typescript
// vite.config.ts
server: {
  // ... other settings
  fs: {
    allow: [
      '.',
      'C:/Users/liang/Desktop/ML Notebooks/embedding-atlas'  // Path to linked package
    ],
  },
},
```

#### 2. Exclude All Linked Packages from Pre-Bundling

```typescript
// vite.config.ts
optimizeDeps: {
  exclude: [
    "embedding-atlas",
    "@embedding-atlas/viewer",
    "@embedding-atlas/component",
    "@embedding-atlas/table",
    "@uwdata/mosaic-core",
    "@duckdb/duckdb-wasm"
  ],
},
```

### npm link Workflow

To test local modifications to `embedding-atlas`:

```bash
# 1. Build the modified packages
cd embedding-atlas/packages/utils && npm run package
cd ../component && npm run package
cd ../table && npm run package
cd ../viewer && npx vite build --config vite.config.lib.js

# 2. Link the packages
cd ../viewer && npm link
cd ../embedding-atlas && npm link @embedding-atlas/viewer
cd ../embedding-atlas && npm run build
cd ../embedding-atlas && npm link

# 3. Use linked packages in web-app
cd web-app && npm link embedding-atlas

# 4. Clear Vite cache and restart
rmdir /s /q node_modules\.vite
npm run dev
```

### To Restore npm Version

```bash
cd web-app
npm unlink embedding-atlas
npm install
```

### Result
- Labels generate correctly with linked packages
- Highlight feature (programmatic multi-point selection) works
- Local modifications can be tested without publishing to npm

---

## Issue: Labels Not Working with Published npm Package (@dataelvisliang/embedding-atlas)

### Symptoms
After switching from `embedding-atlas` (original) to `@dataelvisliang/embedding-atlas` (forked npm package with highlight support):
- Map renders correctly
- Points display correctly
- Labels stuck at "Generating labels..." forever
- Console shows warnings about missing worker files in `.vite/deps/`

### Root Cause
The `vite.config.ts` had `embedding-atlas` in `optimizeDeps.exclude`, but the new package name `@dataelvisliang/embedding-atlas` was not included. Vite was pre-bundling the new package, breaking the WASM worker path resolution.

### The Fix

Add the new package name to `optimizeDeps.exclude`:

```typescript
// vite.config.ts
optimizeDeps: {
  exclude: [
    "embedding-atlas",
    "@dataelvisliang/embedding-atlas",  // NEW: forked package with highlight support
    "@embedding-atlas/viewer",
    "@embedding-atlas/component",
    "@embedding-atlas/table",
    "@uwdata/mosaic-core",
    "@duckdb/duckdb-wasm"
  ],
},
```

### Key Lesson
When switching to a different npm package (even a fork of the same library), always update `optimizeDeps.exclude` to include the new package name. The package name in the exclude list must exactly match the name in `package.json` dependencies.

### Result
- Labels generate correctly with the published `@dataelvisliang/embedding-atlas` package
- Highlight feature works (agent tool results highlight points on map)
- No need for `npm link` - uses published npm package directly
