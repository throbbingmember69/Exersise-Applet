import { Suspense } from 'react'
import { Outlet } from 'react-router'
import BottomNav from './BottomNav'
import styles from './AppShell.module.css'
import Spinner from './Spinner'

/** Mobile layout: scrolling content above a fixed bottom tab bar. */
export default function AppShell() {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <Suspense fallback={<Spinner label="Loading" />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  )
}
