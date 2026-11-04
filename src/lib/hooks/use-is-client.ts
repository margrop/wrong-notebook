import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** 客户端渲染时为 true；服务端渲染和水合阶段为 false，避免两端输出不一致 */
export function useIsClient(): boolean {
    return useSyncExternalStore(subscribe, () => true, () => false);
}
