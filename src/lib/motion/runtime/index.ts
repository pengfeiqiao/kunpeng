/**
 * runtime/index — KPMotion IIFE 入口。
 *
 * 两端注入：
 * - 预览端（fxRender.ensureMotionRuntime）：new Function(源码) 执行，
 *   随后 KPMotion.hydrate(stage) / instance.renderFrame(t)。
 * - 导出端（render-worker buildHtml）：<script> 内联，load 时 bootstrap：
 *   hydrateAll(document) + 注册 __kunpengRenderLayerFrame layer 级分发器
 *   （修复多 free-page 全局 __kunpengRenderFrame 打架的存量隐患）。
 *
 * 硬约束：整个 runtime 禁 rAF/setInterval/Date.now/Math.random —— 一切由 t 驱动。
 */
import { hydrateScene, type SceneInstance } from './hydrate';

declare const KP_MOTION_VERSION_INJECTED: string | undefined;

const VERSION = typeof KP_MOTION_VERSION_INJECTED === 'string' ? KP_MOTION_VERSION_INJECTED : 'dev';

interface KPMotionApi {
  version: string;
  /** hydrate 单个宿主（含 script[data-kp-scene-spec] 的容器）；幂等 */
  hydrate(host: HTMLElement): SceneInstance | null;
  /** hydrate root 下所有场景宿主 */
  hydrateAll(root: ParentNode): SceneInstance[];
  /** 对宿主（或其内部场景）渲染 t 秒帧；未 hydrate 时自动 hydrate */
  renderFrame(host: HTMLElement, t: number): void;
  dispose(host: HTMLElement): void;
}

type SceneHost = HTMLElement & { __kpSceneInstance?: SceneInstance };

function findHosts(root: ParentNode): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>('script[data-kp-scene-spec]').forEach((specEl) => {
    const host = specEl.closest<HTMLElement>('[data-kp-layer]') ?? specEl.parentElement;
    if (host) hosts.push(host);
  });
  return hosts;
}

const KPMotion: KPMotionApi = {
  version: VERSION,
  hydrate(host) {
    return hydrateScene(host);
  },
  hydrateAll(root) {
    const out: SceneInstance[] = [];
    for (const host of findHosts(root)) {
      const inst = hydrateScene(host);
      if (inst) out.push(inst);
    }
    return out;
  },
  renderFrame(host, t) {
    const cached = (host as SceneHost).__kpSceneInstance;
    const inst = cached ?? hydrateScene(host);
    inst?.renderFrame(t);
  },
  dispose(host) {
    (host as SceneHost).__kpSceneInstance?.dispose();
  },
};

declare global {
  interface Window {
    KPMotion?: KPMotionApi;
    __kunpengRenderFrame?: (t: number) => unknown;
    __kunpengRenderLayerFrame?: (layer: HTMLElement, localSec: number, globalSec: number) => unknown;
  }
}

(function bootstrap() {
  if (typeof window === 'undefined') return;
  window.KPMotion = KPMotion;

  // 导出端 worker 文档：__seekKunpeng 会对每个 [data-kp-layer] 调
  // __kunpengRenderLayerFrame(layer, localSec, globalSec)。注册 layer 级分发器，
  // 让每个 scene layer 用自己的 local 秒渲染，互不干扰。
  // 尊重已有定义（用户 free-page 理论上可能自定义，虽然校验禁止）。
  if (typeof window.__kunpengRenderLayerFrame !== 'function') {
    window.__kunpengRenderLayerFrame = (layer: HTMLElement, localSec: number) => {
      if (layer.querySelector('script[data-kp-scene-spec]')) {
        KPMotion.renderFrame(layer, localSec);
      }
    };
  }

  // 单文档（非多 layer）导出：若无人定义全局 __kunpengRenderFrame 且文档里有场景，
  // 补一个全局驱动（__seekKunpeng 在无 layer 时只调它 + WAAPI）。
  if (typeof document !== 'undefined' && typeof window.__kunpengRenderFrame !== 'function') {
    const bindGlobal = () => {
      const stage = document.getElementById('stage') ?? document.body;
      if (!stage || !stage.querySelector('script[data-kp-scene-spec]')) return;
      // 多 layer 文档交给 layer 分发器，避免全局 t 语义错误
      if (stage.querySelector('[data-kp-layer]')) return;
      window.__kunpengRenderFrame = (t: number) => {
        for (const inst of KPMotion.hydrateAll(stage)) inst.renderFrame(t);
      };
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindGlobal, { once: true });
    } else {
      bindGlobal();
    }
  }
})();

export type { SceneInstance };
export { KPMotion };
