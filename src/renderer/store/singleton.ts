import { createAppStore, freshState } from './appStore';
import { getApi } from '../api';
import i18n from '../i18n';

/** The application store singleton. */
export const useAppStore = createAppStore(getApi, {
  onLanguageChange: (lang) => {
    void i18n.changeLanguage(lang);
  },
});

/** Reset the singleton to a fresh initial state (tests). */
export function resetAppStore(): void {
  useAppStore.setState(freshState());
}
