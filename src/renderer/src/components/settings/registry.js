import { CATEGORY_META, filterSettings } from './registry-data'
import AppearanceSection from './AppearanceSection'
import NotificationsSection from './NotificationsSection'
import TerminalSection from './TerminalSection'
import ModelsSection from './ModelsSection'
import AboutSection from './AboutSection'

const SECTIONS = {
  appearance: AppearanceSection,
  notifications: NotificationsSection,
  terminal: TerminalSection,
  models: ModelsSection,
  about: AboutSection
}

export const CATEGORIES = CATEGORY_META.map((c) => ({ ...c, Section: SECTIONS[c.id] }))
export { filterSettings }
