declare const __APP_VERSION__: string

/** The app version (package.json), stamped into backups. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
