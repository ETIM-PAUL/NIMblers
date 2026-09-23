import { useState } from 'react'
import type { Language } from '../lib/api'
import { detectDeviceLanguage, LANGUAGE_LABELS, LANGUAGES } from '../lib/api'

export function useDefaultLanguage(): [Language, (next: Language) => void, boolean] {
  const [detected] = useState(detectDeviceLanguage)
  const [language, setLanguage] = useState<Language>(detected)
  const [overridden, setOverridden] = useState(false)
  return [language, (next) => { setLanguage(next); setOverridden(next !== detected) }, overridden]
}

interface Props {
  language: Language
  onChange: (language: Language) => void
  /** True once the player has picked something other than the device default — hides the "we picked this for you" notice once they've made their own choice. */
  overridden: boolean
}

/** A duel/practice language picker defaulting to the device's own language, with a short notice explaining why — see `useDefaultLanguage`. */
export function LanguagePicker({ language, onChange, overridden }: Props) {
  return (
    <div className="language-picker-wrap">
      <div className="language-picker">
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            className={`btn btn-toggle ${language === lang ? 'btn-toggle-active' : ''}`}
            onClick={() => onChange(lang)}
          >
            {LANGUAGE_LABELS[lang]}
          </button>
        ))}
      </div>
      {!overridden && (
        <p className="language-picker-notice">Picked based on your device's language — change it above if you'd rather type in a different one.</p>
      )}
    </div>
  )
}
