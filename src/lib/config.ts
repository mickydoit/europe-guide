/** First name for the Home greeting; a build variable because the app has no profile. */
export const OWNER_NAME: string | null = (import.meta.env.VITE_OWNER_NAME as string | undefined)?.trim() || null
