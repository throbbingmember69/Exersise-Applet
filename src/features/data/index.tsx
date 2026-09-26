import { useEffect, useState } from 'react'
import { useCommand, useCtx, useLive, useToast, useToday } from '@/app/hooks'
import { APP_VERSION } from '@/app/version'
import type { CsvKind } from '@/domain/csv'
import { readFileText, saveOrShare } from '@/platform/files'
import {
  backupFileName,
  exportBackup,
  getBackupReminder,
  importBackup,
  markBackupSaved,
  serializeBackup,
  type ImportResult,
} from '@/services/data/backup'
import { exportCsv } from '@/services/data/csvExport'
import {
  getStorageStatus,
  requestPersistentStorage,
  type StorageStatus,
} from '@/services/data/storage'
import { isServiceError } from '@/services/errors'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { Badge, Button, Card, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import ScaleImportCard from './ScaleImportCard'
import styles from './data.module.css'

const CSVS: { kind: CsvKind; label: string }[] = [
  { kind: 'sets', label: 'Workout sets' },
  { kind: 'body', label: 'Body log' },
  { kind: 'nutrition', label: 'Nutrition' },
]

function mb(bytes: number | null): string {
  return bytes === null ? '?' : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Data() {
  const ctx = useCtx()
  const toast = useToast()
  const today = useToday()
  const { data: reminder } = useLive((c) => getBackupReminder(c), [today])
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [restoreText, setRestoreText] = useState<string | null>(null)
  const [shrinking, setShrinking] = useState<Extract<
    ImportResult,
    { status: 'needs_confirm' }
  > | null>(null)
  const markSaved = useCommand(markBackupSaved)
  const restore = useCommand(importBackup)

  useEffect(() => {
    void getStorageStatus().then(setStorage)
  }, [])

  const onBackup = async () => {
    try {
      const backup = await exportBackup(ctx, { appVersion: APP_VERSION })
      const result = await saveOrShare({
        fileName: backupFileName(today),
        mimeType: 'application/json',
        text: serializeBackup(backup),
      })
      if (result === 'shared' || result === 'downloaded') {
        await markSaved.run()
        toast.show('Backup saved', { tone: 'good' })
      } else if (result === 'failed') toast.show('Could not save the backup file', { tone: 'bad' })
    } catch (e) {
      toast.show(isServiceError(e) ? e.message : 'Backup failed', { tone: 'bad' })
    }
  }

  const onCsv = async (kind: CsvKind) => {
    const file = await exportCsv(ctx, kind, { today })
    const result = await saveOrShare(file)
    if (result === 'failed') toast.show('Could not save the CSV file', { tone: 'bad' })
  }

  const onRestore = async (confirmFewerRows: boolean) => {
    if (restoreText === null) return
    const result = await restore.run(restoreText, { confirmFewerRows })
    if (!result) return
    if (result.status === 'needs_confirm') {
      setShrinking(result)
      return
    }
    setRestoreText(null)
    setShrinking(null)
    toast.show('Backup restored', { tone: 'good' })
  }

  return (
    <>
      <PageHeader title="Data & backup" back="/more" />
      <Stack>
        <Card title="Backup">
          <p className={styles.hint}>
            Everything lives on this phone. Clearing browser data or losing the phone loses it, so
            save a backup file somewhere safe (Drive, email) regularly.
            {reminder?.lastBackupAt
              ? ` Last backup ${reminder.daysSince === 0 ? 'today' : `${reminder.daysSince} days ago`}.`
              : ' No backup yet.'}
          </p>
          {reminder?.due ? (
            <p>
              <Badge tone="warn">Backup due</Badge>
            </p>
          ) : null}
          <Button variant="primary" block icon="download" onClick={() => void onBackup()}>
            Save backup file
          </Button>
          <label className={`${kit.button} ${kit.block}`} style={{ marginTop: 'var(--space-2)' }}>
            Restore from backup…
            <input
              type="file"
              accept=".json,application/json"
              className={kit.srOnly}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFileText(f).then(setRestoreText)
                e.target.value = ''
              }}
            />
          </label>
        </Card>

        <ScaleImportCard />

        <Card title="Export CSV">
          <p className={styles.hint}>For spreadsheets. Loads in lb, dates as YYYY-MM-DD.</p>
          <div className={kit.stack}>
            {CSVS.map((c) => (
              <Button key={c.kind} block icon="download" onClick={() => void onCsv(c.kind)}>
                {c.label}
              </Button>
            ))}
          </div>
        </Card>

        <Card title="Storage">
          {storage ? (
            <>
              <p className={styles.row}>
                <span>Protected from automatic clean-up</span>
                <Badge tone={storage.persisted ? 'good' : 'warn'}>
                  {storage.persisted ? 'Yes' : storage.persisted === false ? 'No' : 'Unknown'}
                </Badge>
              </p>
              <p className={styles.hint}>
                Using {mb(storage.usageBytes)} of {mb(storage.quotaBytes)}.
              </p>
              {storage.supported && !storage.persisted ? (
                <Button
                  block
                  onClick={() =>
                    void requestPersistentStorage().then(async (granted) => {
                      setStorage(await getStorageStatus())
                      toast.show(
                        granted
                          ? 'Storage protected'
                          : 'The browser declined; install the app to home screen and try again',
                        { tone: granted ? 'good' : 'neutral' },
                      )
                    })
                  }
                >
                  Protect my data
                </Button>
              ) : null}
            </>
          ) : null}
        </Card>
        <p className={styles.hint}>App version {APP_VERSION}</p>
      </Stack>

      <ConfirmDialog
        open={restoreText !== null && shrinking === null}
        title="Restore this backup?"
        danger
        confirmLabel="Restore"
        onCancel={() => setRestoreText(null)}
        onConfirm={() => void onRestore(false)}
      >
        Everything on this phone is replaced by the backup’s contents.
      </ConfirmDialog>
      <ConfirmDialog
        open={shrinking !== null}
        title="The backup has less data"
        danger
        confirmLabel="Restore anyway"
        onCancel={() => {
          setShrinking(null)
          setRestoreText(null)
        }}
        onConfirm={() => void onRestore(true)}
      >
        {shrinking
          ? `Restoring would lose: ${shrinking.shrinking
              .map((t) => `${t} (${shrinking.current[t]} → ${shrinking.incoming[t]})`)
              .join(', ')}.`
          : null}
      </ConfirmDialog>
    </>
  )
}
