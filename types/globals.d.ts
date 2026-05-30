// Global window properties declared for browser-side code
// Prevents no-undef errors when accessing window.Capacitor, window.MobileUI, etc.

declare global {
  // AudioWorklet processor base class (built-in to AudioWorklet context)
  class AudioWorkletProcessor {
    port?: MessagePort;
    process?(inputs: Float32Array[][], outputs: Float32Array[][], parameters: any): boolean;
    constructor();
  }

  // Extend DOM element types to allow dynamic property access
  // These files use getElementsById/querySelector and access dynamic properties
  interface HTMLElement {
    [key: string]: any;
  }
  interface Element {
    [key: string]: any;
  }
  interface EventTarget {
    [key: string]: any;
  }

  interface Window {
    PIXI?: any;
    Capacitor?: any;
    MobileUI?: any;
    AudioFeatures?: any;
    PaletteColor?: any;
    MeshWarp?: any;
    decodeAnalysisFrame?: (buf: ArrayBuffer) => any;
    connectToTv?: (host?: string, port?: number, code?: number) => Promise<void>;
    setFullscreenEnabled?: (enabled: boolean) => void;
    toggleFullscreen?: () => Promise<void>;
    onKeepScreenOnChange?: (checked: boolean) => void;
    classifySwipe?: (x: number, y: number, dx: number, dy: number, opts?: any) => string;
    cycleView?: (direction: number, state: any, callback: Function) => void;
    // webkit prefixed AudioContext for older browsers
    webkitAudioContext?: typeof AudioContext;
  }

  // Bare PIXI global (when used without window prefix)
  var PIXI: any;
  // Bare MobileUI global (when used without window prefix)
  var MobileUI: any;

  // AudioWorklet processor registration
  function registerProcessor(name: string, constructor: typeof AudioWorkletProcessor): void;
}

export {};
