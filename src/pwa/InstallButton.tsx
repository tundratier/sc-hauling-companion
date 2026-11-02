import { isStandalone, promptInstall, useInstallStore } from './installPrompt'

/** "INSTALL APP": only after the browser offered an install, never in the installed app. */
export function InstallButton() {
  const available = useInstallStore((s) => s.event !== null)
  if (!available || isStandalone()) return null
  return (
    <button type="button" className="btn grow" onClick={() => void promptInstall()}>
      INSTALL APP
    </button>
  )
}
