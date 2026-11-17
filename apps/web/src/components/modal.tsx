import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a modal outside the app root and makes the app inert while it is open, so neither
 * Tab, a click on the backdrop nor a screen reader can reach the page behind it.
 */
export function Modal({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    root.inert = true;
    return () => {
      root.inert = false;
    };
  }, []);
  return createPortal(children, document.body);
}
