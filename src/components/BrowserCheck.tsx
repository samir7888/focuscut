import { useEffect, useState } from 'react';

function isSupported() {
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
  const isEdge = /Edg/.test(navigator.userAgent);
  if (isChrome || isEdge) return true;
  // Allow in dev for testing
  return true;
}

export function BrowserCheck() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isSupported()) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-surface-1 border border-line rounded-md px-4 py-2 text-sm shadow-lg z-50">
      For best results, use the latest Chrome or Edge. Some features may not work in this browser.
    </div>
  );
}
