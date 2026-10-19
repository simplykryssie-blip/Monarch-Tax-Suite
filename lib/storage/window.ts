// The delete window. When a person deletes a file, or a record that has files, it leaves the app at once, but its
// stored files are kept for 24 hours and then permanently deleted by the scheduler (storage_cleanup). After that they
// can't be recovered. Files removed by the system (failed checks, abandoned uploads, rolled-back saves) go at once.

export const DELETE_WINDOW_HOURS = 24;

/** When a file deleted at `now` is purged from storage. */
export const purgeAfter = (now = new Date()) => new Date(now.getTime() + DELETE_WINDOW_HOURS * 3_600_000);

/** What the person is told after deleting something with files. */
export const DELETE_NOTICE = `It's gone from the app now. Its file will be permanently deleted in ${DELETE_WINDOW_HOURS} hours and can't be recovered after that.`;

/** The notice for one deleted thing, e.g. deletedNotice("Document"). */
export const deletedNotice = (what: string) => `${what} deleted. ${DELETE_NOTICE}`;
