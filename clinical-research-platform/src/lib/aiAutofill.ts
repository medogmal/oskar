export type AutofillSnapshot = {
  studyTitle?: string;
  objective?: string;
  keyElements?: string[];
  studyTypeGuess?: string;
  studyGroups?: string[];
  suggestedEffectSize?: number;
  suggestedSampleSize?: number;
  suggestedPrompt?: string;
  sourceLabel?: string;
  blindingProtocolText?: string;
  clinicalDraft?: Record<string, unknown>;
  savedAt?: string;
};

const autofillStorageKey = 'clinresearch.autofillSnapshot';

const isBrowser = () => typeof window !== 'undefined' && Boolean(window.sessionStorage);

export const saveAutofillSnapshot = (snapshot: AutofillSnapshot) => {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.setItem(autofillStorageKey, JSON.stringify(snapshot));
};

export const loadAutofillSnapshot = (): AutofillSnapshot | null => {
  if (!isBrowser()) {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(autofillStorageKey);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as AutofillSnapshot;
  } catch {
    return null;
  }
};

export const clearAutofillSnapshot = () => {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.removeItem(autofillStorageKey);
};
