import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Keep a measured spacer outside the scroll window, not a mounted media subtree. */
export default function WorkspaceVisibleItem({ children, selected }: { children: ReactNode; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(64);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      // 快速滚动防抖：出窗后延迟卸载，回窗立即取消，消除边界闪烁
      if (entry.isIntersecting) { window.clearTimeout(timer); timer = undefined; setVisible(true); }
      else if (!timer) timer = window.setTimeout(() => { timer = undefined; setVisible(false); }, 500);
    }, { rootMargin: '400px 0px' });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element || (!visible && !selected)) return;
    const measure = () => { height.current = Math.max(64, element.getBoundingClientRect().height); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, selected]);
  return <div ref={ref} className="workspace-visible-item" style={visible || selected ? undefined : { height: height.current }}>
    {(visible || selected) && children}
  </div>;
}
