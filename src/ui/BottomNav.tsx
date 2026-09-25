import { NavLink, useLocation } from 'react-router'
import styles from './BottomNav.module.css'
import Icon, { type IconName } from './Icon'

interface Tab {
  to: string
  label: string
  icon: IconName
  /** Route prefixes that also highlight this tab. */
  match: string[]
}

const TABS: Tab[] = [
  { to: '/', label: 'Today', icon: 'today', match: [] },
  { to: '/train', label: 'Train', icon: 'train', match: ['/train'] },
  { to: '/body', label: 'Body', icon: 'body', match: ['/body'] },
  { to: '/food', label: 'Food', icon: 'food', match: ['/food'] },
  { to: '/more', label: 'More', icon: 'more', match: ['/more', '/program', '/settings'] },
]

export default function BottomNav() {
  const { pathname } = useLocation()
  return (
    <nav className={styles.nav} aria-label="Main">
      {TABS.map((tab) => {
        const active =
          tab.to === '/' ? pathname === '/' : tab.match.some((p) => pathname.startsWith(p))
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={styles.tab}
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
