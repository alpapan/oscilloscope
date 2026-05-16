// pixi-shim.js - bridges the UMD pixi.js@8 build (loaded via <script>) and
// ESM consumers (pixi-filters@6) that do `import { Filter, ... } from "pixi.js"`.
//
// Why this exists: pixi-filters@6 ships no UMD/IIFE browser bundle, so it
// has to load via ESM. esm.sh's ESM rebuild of pixi.js@8 has a bug that
// fires "Extension type batcher already has a handler" on app.init(), so
// we cannot load pixi.js itself via esm.sh. The workaround is to load
// pixi.js via the official UMD bundle (which works fine) and tell
// pixi-filters' internal `from "pixi.js"` to resolve to this shim, which
// just re-exports the named exports pixi-filters needs from window.PIXI.
//
// If a future pixi-filters version touches a name not in this list, add
// the missing export here (the bundle scan in the implementation notes
// enumerated the v6.1.x set).

const PIXI = window.PIXI;
if (!PIXI) {
  throw new Error(
    "pixi-shim.js loaded before the UMD pixi.js global was set; ensure the " +
    "<script src='.../pixi.min.js'> tag comes BEFORE the importmap and module."
  );
}

export default PIXI;
export const AlphaFilter = PIXI.AlphaFilter;
export const BlurFilter = PIXI.BlurFilter;
export const BlurFilterPass = PIXI.BlurFilterPass;
export const Color = PIXI.Color;
export const DEG_TO_RAD = PIXI.DEG_TO_RAD;
export const Filter = PIXI.Filter;
export const GlProgram = PIXI.GlProgram;
export const GpuProgram = PIXI.GpuProgram;
export const ImageSource = PIXI.ImageSource;
export const ObservablePoint = PIXI.ObservablePoint;
export const Point = PIXI.Point;
export const Texture = PIXI.Texture;
export const TexturePool = PIXI.TexturePool;
export const TextureSource = PIXI.TextureSource;
export const ViewSystem = PIXI.ViewSystem;
export const deprecation = PIXI.deprecation;
