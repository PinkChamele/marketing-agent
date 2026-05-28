export const getErrMsg = (err: unknown) => err instanceof Error ? err.message : String(err);
