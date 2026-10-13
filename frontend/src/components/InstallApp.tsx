import { useEffect, useState } from "react";

// "Install app" in the top bar:
//   Android / desktop Chrome & Edge – the browser's own install prompt
//   iPhone / iPad Safari – a short how-to (Share → Add to Home Screen); iOS has no install prompt
// Hidden once the app runs installed (standalone).
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [tip, setTip] = useState(false);
  const [installed, setInstalled] = useState(standalone());

  useEffect(() => {
    const onPrompt = (e) => (e.preventDefault(), setPrompt(e));
    const onInstalled = () => (setInstalled(true), setPrompt(null));
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !isIos())) return null;

  async function install() {
    if (prompt) {
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") setInstalled(true);
      setPrompt(null);
    } else setTip(!tip);
  }

  return (
    <div className="install-app">
      <button className="btn ghost small" onClick={install} title="Put FMS BSM on your home screen">
        ⬇ Install app
      </button>
      {tip && (
        <div className="install-tip card" role="dialog" aria-label="Install on iPhone">
          <b>Install on iPhone / iPad</b>
          <ol>
            <li>
              Open this page in <b>Safari</b>.
            </li>
            <li>
              Tap <b>Share</b> (the square with an arrow ⬆).
            </li>
            <li>
              Tap <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
          </ol>
          <button className="btn ghost small" onClick={() => setTip(false)}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}
