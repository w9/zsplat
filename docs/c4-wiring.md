# ZSplat – C4 wiring

How the project is wired: context, containers, and components.

## Level 1 – System Context

```mermaid
C4Context
    title System Context – ZSplat

    Person(user, "User", "Views and loads PLY/SOG files")
    System(zsplat, "ZSplat System", "WebGPU Gaussian Splat renderer (library + playground)")
    System_Ext(files, "PLY / SOG files", "Compressed or standard splat data (URL or File)")

    Rel(user, zsplat, "Uses playground, loads files")
    Rel(zsplat, files, "Fetches or reads")
```

## Level 2 – Containers

```mermaid
C4Container
    title Containers – Playground vs Library

    Person(user, "User")
    Container_Boundary(playground, "Playground") {
        Container(app, "App", "React", "File picker, drag-drop, SH toggle, stats; uses ZSplat")
    }
    Container_Boundary(lib, "zsplat package") {
        Container(zsplat_comp, "ZSplat", "React", "Canvas lifecycle, load → setScene → render loop")
        Container(loaders, "Loaders", "TypeScript", "loadSplat, PLY parser, compressed/standard/SOG loaders")
        Container(renderer, "SplatRenderer", "WebGPU/TS", "Preprocess → sort → render pipeline")
        Container(camera, "Camera", "TypeScript", "Orbit camera, view/proj matrices")
        Container(gpu, "WebGPUContext", "WebGPU", "Device, canvas context, format")
        Container(sorters, "Sorters", "TS + WGSL", "CpuSort, RadixSort, StableRadixSort")
    }
    System_Ext(files, "PLY/SOG")
    System_Ext(webgpu, "WebGPU API")

    Rel(user, app, "Interacts with")
    Rel(app, zsplat_comp, "Renders <ZSplat src=… />")
    Rel(zsplat_comp, loaders, "loadSplatData()")
    Rel(zsplat_comp, renderer, "init, setScene, startLoop")
    Rel(zsplat_comp, camera, "Creates, passes to renderer")
    Rel(renderer, gpu, "init(canvas), submit commands")
    Rel(renderer, camera, "view/proj, position")
    Rel(renderer, sorters, "Sorter interface")
    Rel(loaders, files, "fetch / File.arrayBuffer")
    Rel(gpu, webgpu, "navigator.gpu")
```

## Level 3 – Components (library wiring)

```mermaid
C4Component
    title Component wiring – zsplat library

    Container_Boundary(zsplat_pkg, "zsplat package") {

        Component(zsplat_react, "ZSplat.tsx", "React", "Canvas ref, init renderer, load data, resize, loop")
        Component(load_splat, "loadSplat", "TS", "Auto-detect SOG vs PLY; dispatch to loaders")
        Component(ply_parser, "ply-parser", "TS", "parsePlyHeader, isCompressedPly, readTypedValue")
        Component(compressed_ply, "compressed-ply-loader", "TS", "SuperSplat decompress → SplatData")
        Component(standard_ply, "standard-ply-loader", "TS", "Read float props → SplatData")
        Component(sog_loader, "sog-loader", "TS", "meta.json + WebP → SplatData")
        Component(splat_renderer, "SplatRenderer", "TS", "Preprocess pass, sort, render pass")
        Component(camera_core, "Camera", "TS", "Orbit, view/proj matrices, fitToBounds")
        Component(webgpu_ctx, "WebGPUContext", "TS", "Adapter, device, canvas context")
        Component(sorter_iface, "Sorter", "TS", "ensureCapacity, getInputBuffers, sort, destroy")
        Component(cpu_sort, "CpuSort", "TS", "CPU depth sort, upload indices")
        Component(radix_sort, "RadixSort", "TS + WGSL", "GPU radix (unstable)")
        Component(stable_radix, "StableRadixSort", "TS + WGSL", "GPU radix (stable)")
        Component(preprocess_wgsl, "preprocess.wgsl", "WGSL", "Per-splat: 3D→2D, conic, SH, sort keys")
        Component(render_wgsl, "render.wgsl", "WGSL", "Vertex + fragment, draw splats")
        Component(radix_wgsl, "radixSort.wgsl", "WGSL", "Histogram, prefix-sum, scatter")
    }

    Rel(zsplat_react, load_splat, "loadSplatData()")
    Rel(zsplat_react, splat_renderer, "new, init(), setScene(), startLoop()")
    Rel(zsplat_react, camera_core, "new Camera()")
    Rel(load_splat, ply_parser, "parsePlyHeader, isCompressedPly")
    Rel(load_splat, compressed_ply, "if compressed PLY")
    Rel(load_splat, standard_ply, "if standard PLY")
    Rel(load_splat, sog_loader, "if SOG (meta.json)")
    Rel(compressed_ply, ply_parser, "readTypedValue, chunk/vertex")
    Rel(standard_ply, ply_parser, "readTypedValue")
    Rel(splat_renderer, webgpu_ctx, "gpu.init(canvas)")
    Rel(splat_renderer, camera_core, "view/proj, cameraPos")
    Rel(splat_renderer, sorter_iface, "sorter.sort(encoder)")
    Rel(splat_renderer, preprocess_wgsl, "compute pipeline")
    Rel(splat_renderer, render_wgsl, "render pipeline")
    Rel(cpu_sort, sorter_iface, "implements")
    Rel(radix_sort, sorter_iface, "implements")
    Rel(radix_sort, radix_wgsl, "compute pipelines")
    Rel(stable_radix, sorter_iface, "implements")
    Rel(stable_radix, radix_wgsl, "compute pipelines")
```

## Data flow (runtime)

```mermaid
flowchart LR
    subgraph Load
        A[PLY/SOG] --> B[loadSplat]
        B --> C[SplatData]
    end
    subgraph Frame
        C --> D[setScene → buffers]
        D --> E[Preprocess WGSL]
        E --> F[sort keys/values]
        F --> G[Sorter]
        G --> H[sorted indices]
        H --> I[Render WGSL]
        I --> J[Canvas]
    end
```

- **Preprocess**: reads positions, rotations, scales, colors, SH from GPU buffers; writes `splatOut` (conic, NDC) and sort keys/values.
- **Sorter**: consumes keys (depth) and values (splat index); returns buffer of sorted indices.
- **Render**: reads `splatOut` and sorted indices; draws 6 vertices per splat, fragment shader evaluates Gaussian.
